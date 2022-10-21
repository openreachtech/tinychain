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
  constructor(port = 3001, endpoints = [], chain, wallet) {
    this.server = new WebSocketServer({ port });
    this.endpoints = endpoints;
    this.sockets = [];
    this.chain = chain;
    this.wallet = wallet;
  }

  start() {
    this.server.on("connection", (socket) => this.initServerSocket(socket));
    this.endpoints.forEach((e) => this.initClient(new WebSocket(e), e));
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
            const vote = new Vote(packet.voter, packet.isYes, packet.signature);
            const isNew = self.chain.addVote(vote); // voteを自身に追加
            if (!isNew) break;
            console.log(`succeed adding vote ${vote.hash}`);
            self.sockets.forEach((s) => s.send(data)); // 接続しているペアにブロードキャスト
            if (!this.chain.isProposer()) break;
            // proposerならブロックにsignしてブロードキャスト
            this.chain.pendingBlock.vote = this.chain.votes;
            const proposeBlock = this.wallet.signBlock(this.chain.pendingBlock);
            self.sockets.forEach((s) =>
              s.send(
                JSON.stringify({
                  type: PacketTypes.Block,
                  height: proposeBlock.height,
                  preHash: proposeBlock.preHash,
                  timestamp: proposeBlock.timestamp,
                  txs: proposeBlock.txs,
                  stateRoot: proposeBlock.stateRoot,
                  votes: proposeBlock.votes,
                  signature: proposeBlock.signature,
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
            const b = new Block(
              packet.height,
              packet.preHash,
              packet.timestamp,
              packet.txs,
              packet.proposer,
              packet.stateRoot,
              packet.votes,
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
          const b = new Block(
            packet.height,
            packet.preHash,
            packet.timestamp,
            packet.txs,
            packet.proposer,
            packet.stateRoot
          );

          // 既に同じブロックに投票済みならスキップ
          if (
            0 <
            self.chain.votes.indexOf(
              (v) => v.height === b.height && v.blockHash === b.hash && v.voter === self.wallet.pubKey
            )
          ) {
            break;
          }

          // プロポーズされたブロックをブロードキャスト
          self.sockets.forEach((s) => s.send(data));

          // 正しいブロックなら yes に 不正なブロックなら no に投票
          let isYes;
          try {
            self.chain.validateNewBlock(b);
            isYes = true; // validなブロックの場合は、positive vote
          } catch (e) {
            isYes = false; // invalidなブロックの場合は、negative vote
          }

          // 投票を作ってブロードキャスト
          const v = self.wallet.signVote(new Vote(b.height, b.hash, self.wallet.pubKey, isYes));
          self.chain.addVote(v); // 自身に追加
          self.sockets.forEach((s) =>
            s.send(
              JSON.stringify({
                type: PacketTypes.Vote,
                voter: v.voter,
                isYes: v.isYes,
                signature: v.signature,
              })
            )
          );

          break;
        }
        default:
          console.log(`received unsupported packet`, packet);
          break;
      }
    });
  }
}

const genBroadcastBlockFunc = (p2p) =>
  function (block) {
    p2p.sockets.forEach((s) =>
      s.send(
        JSON.stringify({
          type: PacketTypes.Block,
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

function main() {
  if (process.argv.length === 2) {
    const p2p = new P2P();
    p2p.init();
  } else {
    const p2p = new P2P(3002, ["ws://localhost:3001"]);
    p2p.init();
  }
}

main();

module.exports = { P2P, genBroadcastBlockFunc, genBroadcastTxFunc };
