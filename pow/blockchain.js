"use strict";

const SHA256 = require("crypto-js/sha256");
const { ec } = require("elliptic");

const EC = new ec("secp256k1");

const now = () => Math.floor(new Date().getTime() / 1000);
const genesisBlock = () => new Block(0, "0", now(), "{}", 0);

class Block {
  constructor(height, preHash, timestamp, data, nonce) {
    this.height = height;
    this.preHash = preHash;
    this.timestamp = timestamp;
    this.data = data;
    this.nonce = nonce;
    this.hash = Block.hash(height, preHash, timestamp, data, nonce);
  }

  static hash(height, preHash, timestamp, data, nonce) {
    return SHA256(`${height},${preHash},${timestamp},${data},${nonce}`).toString();
  }
}

class TinyChain {
  constructor(wallet, difficulty = 2) {
    this.blocks = [genesisBlock()];
    this.pool = new TxPool();
    this.wallet = wallet ? wallet : new Wallet();
    this.difficulty = difficulty;
  }

  latestBlock = () => this.blocks[this.blocks.length - 1];

  addBlock(newBlock) {
    this._validBlock(newBlock);
    this.blocks.push(newBlock);
  }

  _validBlock(block) {
    const preBlock = this.latestBlock();
    const expHash = Block.hash(
      block.height,
      block.preHash,
      block.timestamp,
      block.data,
      block.nonce
    );
    if (preBlock.height + 1 !== block.height) {
      throw new Error(`invalid heigh. expected: ${preBlock.height + 1}`);
    } else if (preBlock.hash !== block.preHash) {
      throw new Error(`invalid preHash. expected: ${preBlock.hash}`);
    } else if (expHash !== block.hash) {
      throw new Error(`invalid hash. expected: ${expHash}`);
    } else if (!block.hash.startsWith("0".repeat(this.difficulty))) {
      throw new Error(`invalid hash. expected to start from ${"0".repeat(this.difficulty)}`);
    }
  }

  async genNexBlock() {
    return new Promise((resolve, reject) => {
      let nonce = 0;
      const pre = this.latestBlock();
      const conbaseTx = this._genCoinbaseTx();
      const intervalID = setInterval(() => {
        const data = this.pool.txs.reduce(
          (pre, tx) => pre + tx.toString(),
          conbaseTx.toString()
        );
        const block = new Block(pre.height + 1, pre.hash, now(), data, nonce);
        // if (block.hash.startsWith("00")) {
        if (block.hash.startsWith("0".repeat(this.difficulty))) {
          clearInterval(intervalID);
          // NOTE: すげてのUtxoがブロックに取り込まれたとし、txpoolを空にする
          const spentTxs = this.pool.txs;
          this.pool.txs = [];
          this.pool.updateUnspentTxs(spentTxs);
          this.pool.unspentTxs.push(conbaseTx);
          resolve(block);
        }
        nonce++;
      }, 1000 / 32);
    });
  }

  async startMining() {
    while (true) {
      const block = await this.genNexBlock();
      this.addBlock(block);
      console.log(`new block mined! block number is ${block.height}`);
    }
  }

  _genCoinbaseTx = () => this.wallet.signTx(new Transaction("", this.wallet.pubKey));
}

class Transaction {
  constructor(inHash, outAddr, sig = "") {
    this.inHash = inHash;
    this.inSig = sig;
    this.outAddr = outAddr;
    this.hash = Transaction.hash(inHash, outAddr);
  }

  toString = () => JSON.stringify(this);

  static hash = (inHash, outAddr) => SHA256(`${inHash},${outAddr}`).toString();
}

class Wallet {
  constructor(key) {
    this.key = key ? key : EC.genKeyPair();
    this.priKey = this.key.getPrivate();
    this.pubKey = this.key.getPublic().encode("hex");
  }

  signTx(tx) {
    tx.inSig = toHexString(this.key.sign(tx.hash).toDER());
    return tx;
  }
}

class TxPool {
  constructor() {
    this.txs = [];
    this.unspentTxs = [];
  }

  addTx(tx) {
    TxPool.validateTx(this.unspentTxs, tx);
    this.txs.push(tx);
  }

  balanceOf(address) {
    return this.unspentTxs.reduce((pre, tx) => {
      return tx.outAddr === address ? pre + 1 : pre;
    }, 0);
  }

  updateUnspentTxs(spentTxs) {
    const newUnspents = [...spentTxs];
    this.unspentTxs = this.unspentTxs.filter((unspentTx) => {
      for (let i = 0; i < spentTxs.length; i++) {
        if (spentTxs[i].inHash == unspentTx.hash) {
          spentTxs.splice(i, 1);
          return false;
        }
      }
      return true;
    });
    this.unspentTxs.push(...newUnspents);
  }

  static validateTx(unspentTxs, tx) {
    if (tx.hash !== Transaction.hash(tx.inHash, tx.outAddr)) {
      throw new Error(`invalid tx hash. expected: ${Transaction.hash(tx.inHash, tx.outAddr)}`);
    }
    const inTx = unspentTxs.find((unspentTx) => unspentTx.hash === tx.inHash);
    if (!inTx) throw new Error(`tx in not found`);
    if (!TxPool.validateSig(tx, inTx.outAddr)) {
      throw new Error(`invalid signature`);
    }
  }

  static validateSig(tx, address) {
    const key = EC.keyFromPublic(address, "hex");
    return key.verify(tx.hash, tx.inSig);
  }
}

const toHexString = (bytes) => {
  return Array.from(bytes, (byte) => {
    return ("0" + (byte & 0xff).toString(16)).slice(-2);
  }).join("");
};

module.exports = {
  Block,
  TinyChain,
  Transaction,
  Wallet,
};
