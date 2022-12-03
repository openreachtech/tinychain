"use strict";

const WebSocket = require("ws");
const { WebSocketServer } = require("ws");
const { Transaction, Vote, Block } = require("./blockchain");
const { buildTxObj } = require("./utils");

const PacketTypes = {
  Ack: "Ack",
  Tx: "Transaction",
  Vote: "Vote",
  Block: "Block",
  PBlock: "ProposedBlock",
};

class P2P {
  constructor(port = 5001, endpoints = [], chain, wallet) {
    this.port = port;
    this.server = new WebSocketServer({ port });
    this.endpoints = endpoints; // 接続するPeerのエンドポイント
    this.sockets = []; // 接続しているPeer
    this.chain = chain; // Tinychain
    this.wallet = wallet; // 自分のWallet
  }

  start() {
    this.server.on("connection", (socket) => this.initServerSocket(socket)); // Listenするsocketの初期化
    this.endpoints.forEach((e) => this.initClient(new WebSocket(e), e)); // 接続するsocketの初期化
    console.log(`p2p endpoint listening on port ${this.port}`);
  }

  initServerSocket(socket) {
    socket.on("error", (e) => {
      console.log(`err happen at server connection`, e);
    });

    this.handleMessage(socket); // messageハンドラーを登録

    this.sockets.push(socket); // 初期化済みソケットを登録
  }

  initClient(ws, endpoint) {
    const self = this;

    ws.on("open", function open() {
      self.handleMessage(ws); // メッセージハンドラーを登録
      const ack = { type: PacketTypes.Ack, content: `hello ${endpoint}!` };
      ws.send(JSON.stringify(ack)); // acknowledgementメッセージを送る
    });

    ws.on("error", (e) => {
      console.log(`err happen at ${endpoint} connection`, e);
    });

    this.sockets.push(ws); // 初期化済みソケットを登録
  }

  handleMessage(socket) {
    const self = this;

    // 接続しているPeerからメッセージを受信
    socket.on("message", async (data) => {
      const packet = JSON.parse(data);

      switch (packet.type) {
        // 接続確認メッセージの場合、ログを出すだけ
        case PacketTypes.Ack:
          console.log(`received ack message: ${packet.content}`);
          break;

        // トランザクションを受信した場合、トランザクションプールに追加
        case PacketTypes.Tx:
          try {
            const tx = recoverTx(packet);
            const isNew = await self.chain.pool.addTx(tx); // トランザクションを自身のPoolに追加
            if (!isNew) break; // 新しいトランザクションでない場合は、ブロードキャストしない
            console.log(`succeed adding tx ${tx.hash}`);
            self.sockets.forEach((s) => s.send(data)); // 接続しているPeerにブロードキャスト
          } catch (e) {
            console.error(e);
            break;
          }
          break;

        // 投票を受信した場合、votesに追加
        // 自分がプロポーザで2/3以上の賛同を得られた場合は、確定ブロックをブロードキャスト
        case PacketTypes.Vote:
          try {
            const vote = recoverVote(packet);
            const isNew = self.chain.addVote(vote); // voteを自身に追加
            if (!isNew) break; // 新しいvoteでない場合は、ブロードキャストしない
            console.log(`succeed adding vote ${vote.hash}`);
            self.sockets.forEach((s) => s.send(data)); // 接続しているPeerにブロードキャスト
            if (!self.chain.isProposer()) break;

            // 自分がプロポーザの場合は、投票を集計する
            if (self.chain.votes.length !== self.chain.statestore.validators().length - 1) break; // 投票率が100%かチェック
            if (!self.chain.tallyVotes(self.chain.votes)) {
              // 2/3以上の賛同を得られなければ、ブロックを作り直す
              self.chain.proposeBlock = null;
              self.chain.votes = [];
              break;
            }

            // 2/3以上の賛同を得られれば、得票したらブロックにsignしてブロードキャスト
            console.log(`proposed block was accepted!`);
            let b = self.chain.pendingBlock;
            const newBlock = self.wallet.signBlock(
              new Block(b.height, b.preHash, b.timestamp, b.txs, b.proposer, b.stateRoot, self.chain.votes)
            );
            await self.chain.addBlock(newBlock);
            self.sockets.forEach((s) =>
              s.send(
                JSON.stringify({
                  type: PacketTypes.Block,
                  height: newBlock.height,
                  preHash: newBlock.preHash,
                  timestamp: newBlock.timestamp,
                  txs: newBlock.txs.map((tx) => buildTxObj(tx)),
                  proposer: newBlock.proposer,
                  stateRoot: newBlock.stateRoot,
                  votes: newBlock.votes,
                  signature: newBlock.signature,
                })
              )
            );
          } catch (e) {
            console.error(e);
            break;
          }
          break;

        // ブロックを受信した場合、チェーンに追加
        case PacketTypes.Block:
          try {
            const b = new Block(
              packet.height,
              packet.preHash,
              packet.timestamp,
              packet.txs.map((tx) => recoverTx(tx)),
              packet.proposer,
              packet.stateRoot,
              packet.votes.map((v) => recoverVote(v)),
              packet.signature
            );
            const isNew = await self.chain.addBlock(b);
            if (!isNew) break; // 新しいブロックでねい場合は、ブロードキャストしない
            console.log(`succeed adding block ${b.hash}`);
            self.sockets.forEach((s) => s.send(data)); // 接続しているPeerにブロードキャスト
          } catch (e) {
            console.error(e);
            break;
          }
          break;

        // プロポーズブロックを受信した場合は、検証して正しい場合はYesに、不正の場合はNoに投票する
        case PacketTypes.PBlock: {
          const b = new Block(
            packet.height,
            packet.preHash,
            packet.timestamp,
            packet.txs.map((tx) => recoverTx(tx)),
            packet.proposer,
            packet.stateRoot,
            packet.votes,
            packet.signature
          );
          // プロポーザーなら投票には参加しない
          if (self.chain.isProposer()) break;
          // 古いブロックならスキップ
          if (b.height <= self.chain.latestBlock().height) break;
          // 既に同じブロックに投票済みならスキップ
          if (self.chain.votes.find((v) => v.blockHash === b.hash && v.voter === self.wallet.address)) {
            break;
          }
          // プロポーズされたブロックをブロードキャスト
          self.sockets.forEach((s) => s.send(data));
          console.log(`received ${b.height} th height of proposed block`);

          // 正しいブロックなら yes に 不正なブロックなら no に投票
          let isYes;
          try {
            self.chain.validateBlock(b);
            isYes = true; // validなブロックの場合は、yes vote
          } catch (e) {
            console.log(e);
            isYes = false; // invalidなブロックの場合は、no vote
          }

          // Voteを作ってブロードキャスト
          const v = self.wallet.signVote(new Vote(b.height, b.hash, self.wallet.address, isYes));
          self.chain.addVote(v); // 自身に追加
          self.sockets.forEach((s) =>
            s.send(
              JSON.stringify({
                type: PacketTypes.Vote,
                height: v.height,
                blockHash: v.blockHash,
                voter: v.voter,
                isYes: v.isYes,
                signature: v.signature,
              })
            )
          );
          console.log(`voted ${v.isYes ? "yes" : "no"} to proposed block`);
          break;
        }

        default:
          console.log(`received unsupported packet`, packet);
          break;
      }
    });
  }
}

// 「Tinychain用のプロポーズブロックをブロードキャストする関数」を生成する関数
const genBroadcastProposeBlockFunc = (p2p) =>
  function (block) {
    p2p.sockets.forEach((s) =>
      s.send(
        JSON.stringify({
          type: PacketTypes.PBlock,
          height: block.height,
          preHash: block.preHash,
          timestamp: block.timestamp,
          txs: block.txs.map((tx) => buildTxObj(tx)),
          proposer: block.proposer,
          stateRoot: block.stateRoot,
          votes: block.votes,
          signature: block.signature,
        })
      )
    );
  };

// 「server用の受信したトランザクションをブロードキャストする関数」を生成する関数
const genBroadcastTxFunc = (p2p) =>
  function (tx) {
    p2p.sockets.forEach((s) => s.send(JSON.stringify(Object.assign({ type: PacketTypes.Tx }, buildTxObj(tx)))));
  };

const recoverTx = (txObj) => {
  const { from, to, amount, data, signature } = txObj;
  const gasPrice = txObj.gasPrice ? Number(txObj.gasPrice) : undefined;
  const gasLimit = txObj.gasLimit ? Number(txObj.gasLimit) : undefined;
  return new Transaction(from, to, Number(amount), data, gasPrice, gasLimit, signature);
};

const recoverVote = (voteObj) =>
  new Vote(voteObj.height, voteObj.blockHash, voteObj.voter, voteObj.isYes, voteObj.signature);

module.exports = { P2P, genBroadcastProposeBlockFunc, genBroadcastTxFunc, recoverTx };
