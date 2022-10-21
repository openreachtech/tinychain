"use strict";

const WebSocket = require("ws");
const { WebSocketServer } = require("ws");
const { Transaction, Vote, Block } = require("./blockchain");

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
    this.endpoints = endpoints;
    this.sockets = [];
    this.chain = chain;
    this.wallet = wallet;
  }

  start() {
    this.server.on("connection", (socket) => this.initServerSocket(socket));
    this.endpoints.forEach((e) => this.initClient(new WebSocket(e), e));
    console.log(`p2p endpoint listening on port ${this.port}`);
  }

  initServerSocket(socket) {
    socket.on("error", (e) => {
      console.log(`err happen at server connection`, e);
    });

    this.handleMessage(socket); // messageハンドラーを登録
    this.sockets.push(socket); // 準備のできたソケットを登録
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

    this.sockets.push(ws); // 準備のできたソケットを登録
  }

  handleMessage(socket) {
    const self = this;
    socket.on("message", (data) => {
      const packet = JSON.parse(data);

      switch (packet.type) {
        case PacketTypes.Ack:
          console.log(`received ack message: ${packet.content}`);
          break;

        case PacketTypes.Tx:
          try {
            const tx = new Transaction(packet.from, packet.to, packet.amount, packet.signature);
            const isNew = self.chain.pool.addTx(tx); // トランザクションを自身のPoolに追加
            if (!isNew) break;
            console.log(`succeed adding tx ${tx.hash}`);
            self.sockets.forEach((s) => s.send(data)); // 接続しているペアにブロードキャスト
          } catch (e) {
            console.error(e);
            break;
          }
          break;

        case PacketTypes.Vote:
          try {
            const vote = new Vote(packet.height, packet.blockHash, packet.voter, packet.isYes, packet.signature);
            const isNew = self.chain.addVote(vote); // voteを自身に追加
            if (!isNew) break;
            console.log(`succeed adding vote ${vote.hash}`);
            self.sockets.forEach((s) => s.send(data)); // 接続しているペアにブロードキャスト
            if (!self.chain.isProposer()) break; // プロポーザかチェック
            if (self.chain.votes.length !== self.chain.store.validators().length - 1) break; // 投票率が100%かチェック
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
            self.chain.addBlock(newBlock);
            self.sockets.forEach((s) =>
              s.send(
                JSON.stringify({
                  type: PacketTypes.Block,
                  height: newBlock.height,
                  preHash: newBlock.preHash,
                  timestamp: newBlock.timestamp,
                  txs: newBlock.txs,
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
        case PacketTypes.Block:
          try {
            const votes = packet.votes.map((v) => new Vote(v.height, v.blockHash, v.voter, v.isYes, v.signature));
            const txs = packet.txs.map((t) => new Transaction(t.from, t.to, t.amount, t.signature));
            const b = new Block(
              packet.height,
              packet.preHash,
              packet.timestamp,
              txs,
              packet.proposer,
              packet.stateRoot,
              votes,
              packet.signature
            );
            const isNew = self.chain.addBlock(b);
            if (!isNew) break;
            console.log(`succeed adding block ${b.hash}`);
            self.sockets.forEach((s) => s.send(data)); // 接続しているペアにブロードキャスト
          } catch (e) {
            console.error(e);
            break;
          }
          break;
        case PacketTypes.PBlock: {
          const txs = packet.txs.map((t) => new Transaction(t.from, t.to, t.amount, t.signature));
          const b = new Block(packet.height, packet.preHash, packet.timestamp, txs, packet.proposer, packet.stateRoot);

          if (self.chain.isProposer()) break; // プロポーザーならスキップ

          // 既に同じブロックに投票済みならスキップ
          if (self.chain.votes.find((v) => v.blockHash === b.hash && v.voter === self.wallet.pubKey)) {
            break;
          }

          console.log(`received ${b.height} th height of proposed block`);

          // プロポーズされたブロックをブロードキャスト
          self.sockets.forEach((s) => s.send(data));

          // 正しいブロックなら yes に 不正なブロックなら no に投票
          let isYes;
          try {
            self.chain.validateNewBlock(b);
            isYes = true; // validなブロックの場合は、positive vote
          } catch (e) {
            console.log(e);
            isYes = false; // invalidなブロックの場合は、negative vote
          }

          // 投票を作ってブロードキャスト
          const v = self.wallet.signVote(new Vote(b.height, b.hash, self.wallet.pubKey, isYes));
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

const genBroadcastPendingBlockFunc = (p2p) =>
  function (block) {
    p2p.sockets.forEach((s) =>
      s.send(
        JSON.stringify({
          type: PacketTypes.PBlock,
          height: block.height,
          preHash: block.preHash,
          timestamp: block.timestamp,
          txs: block.txs,
          proposer: block.proposer,
          stateRoot: block.stateRoot,
          votes: block.votes,
          signature: block.signature,
        })
      )
    );
  };

const genBroadcastTxFunc = (p2p) =>
  function (tx) {
    p2p.sockets.forEach((s) =>
      s.send(
        JSON.stringify({
          type: PacketTypes.Tx,
          from: tx.from,
          to: tx.to,
          amount: tx.amount,
          signature: tx.signature,
        })
      )
    );
  };

module.exports = { P2P, genBroadcastPendingBlockFunc, genBroadcastTxFunc };
