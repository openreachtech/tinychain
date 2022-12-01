"use strict";

const { writeFileSync } = require("fs");
const { Command } = require("commander");
const axios = require("axios");
const { Transaction, Wallet } = require("./blockchain");
const { readWallet, buildTxObj } = require("./utils");

const program = new Command();
program.name("TinyWallet").description("wallet for tinychain").version("1.0.0");

program
  .command("wallet")
  .argument("<name>", "wallet name")
  .option("-d, --dir <string>", "priv key exporting directory", "./wallet")
  .description("create new wallet")
  .action(async (subCmd, options) => {
    const wallet = new Wallet();
    console.log(`wallet address is ${wallet.address}`);
    writeFileSync(`${options.dir}/privkey-${subCmd}`, wallet.priKey);
  });

program
  .command("balance")
  .description("show balance of specific address")
  .argument("<address>", "wallet address")
  .option("-p, --port <number>", "the port json endpoint", 3001)
  .action(async (subCmd, options) => {
    const result = await axios.get(`http://localhost:${options.port}/balance/${subCmd}`);
    console.log(result.data);
  });

program
  .command("transfer")
  .description("transfer coin to somebody")
  .argument("<address>", "recipient wallet address")
  .requiredOption("-w, --wallet <string>", "the location of private key")
  .requiredOption("-a, --amount <number>", "the amount of coin to send")
  .option("-p, --port <number>", "the port json endpoint", 3001)
  .action(async (subCmd, options) => {
    const wallet = new Wallet(readWallet(options.wallet));
    const tx = wallet.signTx(new Transaction(wallet.address, subCmd, options.amount));
    const result = await axios.post(`http://localhost:${options.port}/sendTransaction`, buildTxObj(tx));
    console.log(result.data);
  });

program
  .command("contract-send")
  .description("send contract transaction")
  .argument("<data>", "the calldata of transaction")
  .requiredOption("-w, --wallet <string>", "the location of private key")
  .option("-a, --amount <number>", "the amount of coin to send", 0)
  .option("-p, --port <number>", "the port json endpoint", 3001)
  .option("-c, --contract <string>", "the contract address", "")
  .action(async (subCmd, options) => {
    const wallet = new Wallet(readWallet(options.wallet));
    const tx = wallet.signTx(new Transaction(wallet.address, options.contract, options.amount, subCmd));
    const result = await axios.post(`http://localhost:${options.port}/sendTransaction`, buildTxObj(tx));
    console.log(result.data);
  });

program
  .command("contract-call")
  .description("call contract function")
  .argument("<data>", "the calldata of transaction")
  .requiredOption("-c, --contract <string>", "the contract address")
  .option("-p, --port <number>", "the port json endpoint", 3001)
  .action(async (subCmd, options) => {
    const tx = new Transaction("", options.contract, 0, subCmd);
    const result = await axios.post(`http://localhost:${options.port}/callContract`, buildTxObj(tx));
    console.log(result.data);
  });

program.parse();

process.on("unhandledRejection", (err) => {
  console.log(err);
  process.exit(1);
});
