"use strict";

const { Command } = require("commander");
const express = require("express");
const bodyParser = require("body-parser");

const { Tinychain, Transaction } = require("./blockchain");
const gensisStates = require("./genesisStates");
const { readWallet } = require("./utils");
const { P2P, generateBroadcastBlockFunc } = require("./p2p");

const program = new Command();
program.name("TinyNode").description("node for tinycoin").version("1.0.0");

program
  .command("chain")
  .requiredOption("-w, --wallet <string>", "the location of private key")
  .requiredOption("-p, --port <number>", "the port json endpoint")
  .requiredOption("--p2p-port <number>", "the p2p port of chain")
  .option("--p2p-endpoints <items>", "the p2p connecting pairs list")
  .description("run tinychain server")
  .action(async (options) => {
    const wallet = readWallet(options.wallet);
    const blockchain = new Tinychain(wallet, gensisStates);
    const endpoints = options.p2pEndpoints ? options.p2pEndpoints.split(",") : [];
    const p2p = new P2P(options.p2pPort, endpoints, blockchain, wallet);

    startServer(options.port, blockchain);

    blockchain.start(generateBroadcastBlockFunc(p2p));
  });

program.parse();

process.on("unhandledRejection", (err) => {
  console.log(err);
  process.exit(1);
});

function startServer(port, blockchain) {
  const app = express();
  app.use(bodyParser.json());

  app.get("/", (req, res) => {
    res.send("Hello World!");
  });

  app.get("/balance/:address", (req, res) => {
    res.send({ balance: blockchain.store.balanceOf(req.params.address) });
  });

  app.post("/sendTransaction", (req, res) => {
    const { from, to, amount, signature } = req.body;
    try {
      blockchain.pool.addTx(new Transaction(from, to, amount, signature));
    } catch (e) {
      res.send({ msg: `fail. err: ${e.message}` });
      return;
    }
    res.send({ msg: "success" });
  });

  app.listen(port, () => {
    console.log(`Tinycoin Node is listening on port ${port}`);
  });
}
