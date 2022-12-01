"use strict";

const { Command } = require("commander");
const express = require("express");
const bodyParser = require("body-parser");

const { Wallet, Tinychain } = require("./blockchain");
const gensisStates = require("./genesisStates");
const { readWallet } = require("./utils");
const { P2P, genBroadcastProposeBlockFunc, genBroadcastTxFunc, recoverTx } = require("./p2p");

const program = new Command();
program.name("Tinychain").description("node of tinychain").version("1.0.0");

program
  .command("chain")
  .requiredOption("-w, --wallet <string>", "the location of private key")
  .requiredOption("-p, --port <number>", "the port json endpoint")
  .requiredOption("--p2p-port <number>", "the p2p port of chain")
  .option("--p2p-endpoints <items>", "the p2p connecting pairs list")
  .description("run tinychain server")
  .action(async (options) => {
    const wallet = new Wallet(readWallet(options.wallet));
    const blockchain = new Tinychain(wallet, gensisStates);
    const endpoints = options.p2pEndpoints ? options.p2pEndpoints.split(",") : [];
    const p2p = new P2P(options.p2pPort, endpoints, blockchain, wallet);
    // p2p用のwebsocketサーバを起動
    p2p.start();
    // jsonエンドポイント用のサーバーを起動
    startServer(options.port, blockchain, genBroadcastTxFunc(p2p));
    // ブロック生成を開始
    blockchain.start(genBroadcastProposeBlockFunc(p2p));
  });

program.parse();

process.on("unhandledRejection", (err) => {
  console.log(err);
  process.exit(1);
});

function startServer(port, blockchain, broadcastTx) {
  const app = express();
  app.use(bodyParser.json());

  app.get("/", (req, res) => {
    res.send("Hello World!");
  });

  app.get("/balance/:address", (req, res) => {
    res.send({ balance: blockchain.statestore.balanceOf(req.params.address) });
  });

  app.post("/sendTransaction", async (req, res) => {
    const tx = recoverTx(req.body);
    let receipt;
    try {
      receipt = await blockchain.pool.addTx(tx);
    } catch (e) {
      res.send({ msg: `fail. err: ${e.message}` });
      return;
    }
    res.send(receipt);
    broadcastTx(tx); // 受信したトランザクションを他のペアにブロードキャスト
  });

  app.post("/callContract", async (req, res) => {
    const tx = recoverTx(req.body);
    let result;
    try {
      result = await blockchain.statestore.callContract(tx.to, tx.data);
    } catch (e) {
      res.send({ msg: `fail. err: ${e.message}` });
      return;
    }
    res.send({ result });
  });

  app.listen(port, () => {
    console.log(`http endpoint listening on port ${port}`);
  });
}
