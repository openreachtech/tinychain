"use strict";

const { readFileSync } = require("fs");
const { Command } = require("commander");
const express = require("express");
const bodyParser = require("body-parser");
const { ec } = require("elliptic");
const { Tinycoin, Wallet, Transaction } = require("./blockchain");

const EC = new ec("secp256k1");
const program = new Command();
program.name("TinyNode").description("node for tinycoin").version("1.0.0");

program
  .command("chain")
  .requiredOption("-w, --wallet <string>", "the location of private key")
  .option("-d, --difficulty <number>", "the difficulty of chain", 2)
  .description("create new wallet")
  .action(async (options) => {
    const blockchain = new Tinycoin(readWallet(options.wallet), options.difficulty);

    startServer(3000, blockchain);

    try {
      await blockchain.startMining();
    } catch (e) {
      console.error(`error happen while mining: err: ${e.message}`);
    }
  });

program.parse();

process.on("unhandledRejection", (err) => {
  console.log(err);
  process.exit(1);
});

function readWallet(location) {
  const buffer = readFileSync(location, "utf8");
  const key = EC.keyFromPrivate(buffer.toString(), "hex");
  return new Wallet(key);
}

function startServer(port, blockchain) {
  const app = express();
  app.use(bodyParser.json());

  app.get("/", (req, res) => {
    res.send("Hello World!");
  });

  app.get("/balance/:address", (req, res) => {
    res.send({ balance: blockchain.pool.balanceOf(req.params.address) });
  });

  app.get("/unspentTxs", (req, res) => {
    res.send(blockchain.pool.unspentTxs);
  });

  app.post("/sendTransaction", (req, res) => {
    const { inHash, outAddr, inSig } = req.body;
    blockchain.pool.addTx(new Transaction(inHash, outAddr, inSig));
    res.send({ msg: "success" });
  });

  app.listen(port, () => {
    console.log(`Tinycoin Node is listening on port ${port}`);
  });
}
