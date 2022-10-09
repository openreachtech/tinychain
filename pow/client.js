"use strict";

const {writeFileSync, readFileSync} = require("fs");
const { Command } = require("commander");
const axios = require('axios');
const { ec } = require('elliptic');
const { Transaction, Wallet } = require('./blockchain');

const EC = new ec('secp256k1');
const program = new Command();
program.name("TinyWallet").description("wallet for tinychain").version("1.0.0");

program
  .command("wallet")
  .argument("<name>", "wallet name")
  .option("-d, --dir <string>", "priv key exporting directory", "./wallet")
  .description("create new wallet")
  .action(async (subCmd, options) => {
    const wallet = new Wallet();
    console.log(`wallet address is ${wallet.pubKey}`);
    writeFileSync(`${options.dir}/privkey-${subCmd}`, wallet.priKey.toString(16));
  })

program
  .command("balance")
  .description("show balance of specific address")
  .argument("<address>", "wallet address")
  .action(async (subCmd) => {
    const result = await axios.get(`http://localhost:3000/balance/${subCmd}`)
    console.log(result.data)
  })

program
  .command("transfer")
  .description("transfer coin to somebody")
  .argument("<address>", "recipient wallet address")
  .requiredOption("-w, --wallet <string>", "the location of private key")
  .action(async (subCmd, options) => {

    const wallet = readWallet(options.wallet)
    let result = await axios.get(`http://localhost:3000/unspentTxs`)
    const unspentTx = result.data.find(tx => tx.outAddr === wallet.pubKey)
    if (!unspentTx) {
      throw `no available unspent transaction`
    }
    const tx = wallet.signTx(new Transaction(unspentTx.hash, subCmd));
    result = await axios.post(`http://localhost:3000/sendTransaction`, tx)
    console.log(result.data)
  })

program.parse();

process.on("unhandledRejection", (err) => {
  console.log(err);
  process.exit(1);
});

function readWallet(location) {
  const buffer = readFileSync(location, 'utf8');
  const key = EC.keyFromPrivate(buffer.toString(), 'hex');
  return new Wallet(key);
}
