"use strict";

const SHA256 = require("crypto-js/sha256");
const { ec } = require("elliptic");

const EC = new ec("secp256k1");
const now = () => Math.floor(new Date().getTime() / 1000);
const toHexString = (bytes) => {
  return Array.from(bytes, (byte) => {
    return ("0" + (byte & 0xff).toString(16)).slice(-2);
  }).join("");
};

class Tinychain {
  constructor(wallet, genesisStates) {
    this.wallet = wallet ? wallet : new Wallet(); // コインベースTxを受け取るウォレット
    this.pool = new TxPool();
    this.store = new StateStore(genesisStates);
    const stateRoot = Block.computeStateRoot(genesisStates);
    this.blocks = [new Block(0, "", now(), "", stateRoot, this.store.validators())];
    this.votes = [];
    this.stopFlg = false;
  }

  latestBlock() {
    return this.blocks[this.blocks.length - 1];
  }

  addBlock(newBlock) {
    let isNew = this.latestBlock().height < newBlock.heigh ? true : false;
    if (!isNew) return false; // 新規のブロックでない場合はスキップ
    this.validateBlock(newBlock);
    this.store.applyTransactions(newBlock.txs); // stateの更新
    this.store.applyRewards(newBlock.propoer, newBlock.votes); // rewardの付与
    this.blocks.push(newBlock);
    return true;
  }

  validateNewBlock(b) {
    const preBlock = this.latestBlock();
    const expectedData = TxPool.toData(this.pool.txs);
    const expectedProposer = this.electProposer(this.store.validators(), b.heigh);
    const expectedStateRoot = Block.computeStateRoot(this.pool.pendingStates);
    if (b.height !== preBlock.height + 1) {
      // ブロック高さが直前のブロックの次であるかチェック
      throw new Error(`invalid heigh. expected: ${preBlock.height + 1}`);
    } else if (b.preHash !== preBlock.hash) {
      // 前ブロックハッシュ値が直前のブロックのハッシュ値と一致するかチェック
      throw new Error(`invalid preHash. expected: ${preBlock.hash}`);
    } else if (TxPool.serializeTxs(b.txs) !== TxPool.serializeTxs(this.pool.txs)) {
      // Dataの計算結果が一致するかチェック
      throw new Error(`invalid data. expected: ${expectedData}`);
    } else if (b.proposer !== expectedProposer) {
      // 正しいブロッックプロポーザーかチェック
      throw new Error(`invalid propoer. expected: ${expectedProposer}`);
    } else if (b.stateRoot !== expectedStateRoot) {
      // StateRootの計算結果が一致するかチェック
      throw new Error(`invalid state root. expected: ${expectedStateRoot}`);
    }
  }

  electProposer(validators, heigh) {
    // ブロック高さのハッシュ値の先頭１byteを決定的な乱数として使う
    const threshold = Number(`0x${SHA256(heigh).toString().slice(0, 2)}`);
    const totalStake = validators.reduce((pre, v) => pre + v.stake, 0);
    let sumOfVotingPower;
    return validators.find((v) => {
      let votingPower = 256 * (v.stake / totalStake); // VotingPowerはstake量によって荷重される
      sumOfVotingPower += votingPower;
      return threshold <= sumOfVotingPower; // VotingPowerがはじめて閾値を超えたバリデータをプロポーザとして選出
    });
  }

  validateBlock(b) {
    const preBlock = this.latestBlock();
    const expHash = Block.hash(b.height, b.preHash, b.timestamp, b.txs, b.proposer, b.stateRoot, b.votes);
    if (b.height !== preBlock.height + 1) {
      // ブロック高さが直前のブロックの次であるかチェック
      throw new Error(`invalid heigh. expected: ${preBlock.height + 1}`);
    } else if (b.preHash !== preBlock.hash) {
      // 前ブロックハッシュ値が直前のブロックのハッシュ値と一致するかチェック
      throw new Error(`invalid preHash. expected: ${preBlock.hash}`);
    } else if (b.hash !== expHash) {
      // ハッシュ値が正しいく計算されているかチェック
      throw new Error(`invalid hash. expected: ${expHash}`);
    }
    // 署名が正しいかチェック
    Block.validateSig(b);
    // 2/3以上のyesを集めているかチェック
    if (!this.tallyVotes(b.votes)) {
      throw new Error(`insufficient positive votes`);
    }
  }

  addVote(vote) {
    this.validateVote(vote);
    let isNew;
    const index = this.votes.indexOf((v) => v.voter === vote.voter && v.blockHash === vote.blockHash);
    if (0 < index) {
      isNew = this.votes[index].isNew === vote.isNew ? false : true;
      this.votes[index] = vote; // ２重投票の場合は上書き
    } else {
      isNew = true;
      this.votes.push(vote);
    }
    return isNew;
  }

  validateVote(vote) {
    // heightが次のブロックと等しいかチェック
    if (vote.heigh !== this.latestBlock().height + 1) {
      throw new Error(`invalid height. expected: ${this.latestBlock().height + 1}`);
    }
    // hash値が正しく計算されているかチェック
    if (vote.hash !== Vote.hash(vote.heigh, vote.voter, vote.isYes)) {
      throw new Error(`invalid vote hash. expected: ${Vote.hash(vote.heigh, vote.voter, vote.isYes)}`);
    }
    // 署名が正当かどうかチェック
    if (!Vote.validateSig(vote)) {
      throw new Error(`invalid signature`);
    }
    // voterがvalidatorかチェック
    if (this.state.validators().indexOf((v) => v.key === vote.voter) < 0) {
      throw new Error(`voter should be validator`);
    }
    // 当該プロックのプロポーザではないことをチェック
    if (vote.voter === this.electProposer(this.state.validators(), this.heigh + 1)) {
      throw new Error(`voter is proposer`);
    }
  }

  tallyVotes() {
    // yes投票の割合
    const rate = this.votes.filter((v) => v.isYes).length / (this.state.validators() - 1);
    // yesが2/3以上であれば合格
    return 2 / 3 <= rate;
  }

  generateBlock() {
    const preBlock = this.latestBlock();
    const propoer = this.wallet.pubKey;
    const stateRoot = Block.computeStateRoot(this.pool.pendingStates);
    return new Block(preBlock.height + 1, preBlock.hash, this.pool.txs, propoer, stateRoot, this.state.validators());
  }

  async start() {
    while (!this.stopFlg) {
      const block = await this.genNexBlock();
      this.addBlock(block);
      console.log(`new block mined! block number is ${block.height}`);
    }
  }

  _genCoinbaseTx() {
    // minerへの報酬として支払われるコインベーストランザクション
    // inputがなくて、outputがminerのウォレット
    return this.wallet.signTx(new Transaction("", this.wallet.pubKey));
  }
}

class Block {
  constructor(height, preHash, timestamp, txs, proposer, stateRoot, votes = [], sig = "") {
    this.height = height;
    this.preHash = preHash;
    this.timestamp = timestamp;
    this.txs = txs;
    this.proposer = proposer;
    this.stateRoot = stateRoot;
    this.votes = votes;
    this.signature = sig;
    this.hash = Block.hash(height, preHash, timestamp, txs, proposer, stateRoot, votes, sig);
  }

  static computeStateRoot(states) {
    const serialized = states.reduce((pre, state) => pre + state.toString(), "");
    return SHA256(serialized).toString();
  }

  static hash(height, preHash, timestamp, txs, proposer, stateRoot, votes) {
    const txsStr = TxPool.serializeTxs(txs);
    const votesStr = votes.reduce((pre, vote) => pre + vote.toString(), "");
    return SHA256(`${height},${preHash},${timestamp},${txsStr},${proposer},${stateRoot},${votesStr}`).toString();
  }

  static validateSig(block) {
    return EC.keyFromPublic(block.proposer, "hex").verify(block.hash, block.signature);
  }
}

class StateStore {
  constructor(states = []) {
    this.states = states;
  }

  balanceOf(addr) {
    return this.states.find((state) => 0 < state.key === addr).balance;
  }

  validators() {
    return this.states.filter((state) => 0 < state.stake); // stakeしていればバリデータとみなす
  }

  applyTransactions(txs) {
    txs.forEach((tx) => (this.states = StateStore.applyTransaction(this.states, tx)));
  }

  applyRewards(propoer, votes) {
    // proposerのリワードは”３”
    this.states[this.states.indexOf((s) => s.key === propoer)].balance += 3;
    // yesに投票したvoterのリワードは”１”
    votes
      .filter((v) => v.isYes)
      .map((v) => v.voter)
      .forEach((voter) => {
        this.states[this.states.indexOf((s) => s.key === voter)].balance += 1;
      });
  }

  static applyTransaction(states, tx) {
    // fromのバランスを更新
    const fromIndex = states.indexOf((state) => state.key === tx.from);
    if (fromIndex < 0) throw new Error(`no state found by key(=${tx.from})`);
    // toのバランスを更新
    const toIndex = states.indexOf((state) => state.key === tx.to);
    if (toIndex < 0) {
      states.push(new State(tx.to, tx.amount)); // stateを新規追加
    } else {
      states[toIndex].updateBalance(tx.amount); // stateを更新
    }
    return states;
  }

  computeStateRoot() {
    // StateRootは「全statesを文字列にして繋げたもののhash値」とする
    return SHA256(this.states.reduce((pre, state) => pre + state.toString(), "")).toString();
  }
}

class State {
  constructor(addr, amount, stake = 0) {
    this.key = addr;
    this.balance = amount;
    this.stake = stake;
    this.hash = this.hash();
  }

  toString() {
    return JSON.stringify(this);
  }

  hash() {
    return SHA256(`${this.key},${this.balance},${this.stake}`).toString();
  }

  updateBalance(amount) {
    this.balance = +amount;
    if (this.balance < 0) throw new Error(`ballance of ${this.key} is negative`);
    this.hash = this.hash();
  }
}

class Transaction {
  constructor(from, to, amount, sig = "") {
    this.from = from;
    this.to = to;
    this.amount = amount;
    this.signature = sig;
    this.hash = Transaction.hash(from, to, amount);
  }

  toString() {
    return JSON.stringify(this);
  }

  static hash(from, to, amount) {
    return SHA256(`${from},${to},${amount}`).toString();
  }

  static validateSig(tx, address) {
    return EC.keyFromPublic(address, "hex").verify(tx.hash, tx.inSig);
  }
}

class TxPool {
  constructor() {
    this.txs = [];
    this.pendingStates = [];
  }

  addTx(tx) {
    TxPool.validateTx(tx);
    if (0 < this.txs.indexOf((t) => t.hash === tx.hash)) return false; // 新規のTxではない
    this.pendingStates = StateStore.applyTransaction(this.pendingStates, tx);
    this.txs.push(tx);
    return true;
  }

  static validateTx(tx) {
    // hash値が正しく計算されているかチェック
    if (tx.hash !== Transaction.hash(tx.from, tx.to, tx.amount)) {
      throw new Error(`invalid tx hash. expected: ${Transaction.hash(tx.from, tx.to, tx.amount)}`);
    }
    // 署名が正当かどうかチェック
    if (!Transaction.validateSig(tx, tx.to)) {
      throw new Error(`invalid signature`);
    }
  }

  static serializeTxs(txs) {
    return txs.reduce((pre, tx) => pre + tx.toString(), "");
  }
}

class Wallet {
  constructor(key) {
    this.key = key ? key : EC.genKeyPair(); // 秘密鍵の生成
    this.priKey = this.key.getPrivate();
    this.pubKey = this.key.getPublic().encode("hex"); // この公開鍵をアドレスとして使う
  }
  // トランザクションに署名する関数
  signTx(tx) {
    tx.inSig = toHexString(this.key.sign(tx.hash).toDER());
    return tx;
  }
  // 投票に署名する関数
  signVote(vote) {
    vote.signature = toHexString(this.key.sign(vote.hash).toDER());
    return vote;
  }
  // Blockに署名する関数
  signBlock(block) {
    block.signature = toHexString(this.key.sign(block.hash).toDER());
    return block;
  }
}

class Vote {
  constructor(height, blockHash, addr, isYes, sig = "") {
    this.heigh = height;
    this.blockHash = blockHash;
    this.voter = addr;
    this.isYes = isYes;
    this.signature = sig;
    this.hash = Vote.hash(this.voter, this.isYes);
  }

  toString() {
    return JSON.stringify(this);
  }

  static hash(height, blockHash, voter, isYes) {
    return SHA256(`${height},${blockHash},${voter},${isYes}`).toString();
  }

  static validateSig(vote) {
    return EC.keyFromPublic(vote.voter, "hex").verify(vote.hash, vote.signature);
  }
}

module.exports = { Block, Tinychain, Transaction, Wallet, State, Vote };