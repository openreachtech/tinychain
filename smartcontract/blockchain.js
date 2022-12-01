"use strict";

const Web3 = require("web3");
const web3 = new Web3();
const SHA256 = require("crypto-js/sha256");
const { Address } = require("@ethereumjs/util");
const { now, emptySlot, ZeroAddress } = require("./utils");
const { StateManager, AccountState, EVM } = require("./evm");

class Tinychain {
  constructor(wallet, genesisStates) {
    this.wallet = wallet ? wallet : new Wallet(); // Rewardを受け取るウォレット
    this.kvstore = new KVStore(); // key-valueストア
    this.statestore = new StateStore(this.kvstore, []);
    // genesis statesを反映
    for (const state of genesisStates) {
      this.statestore.setAccountState(StateManager.key(state.key), state);
    }
    this.pool = new TxPool(this.statestore.clone());
    this.blocks = [new Block(0, "", 0, [], "", StateStore.computeStateRoot(this.statestore), [])];
    this.votes = [];
    this.pendingBlock = null;
    // this.store = new StateStore(genesisStates);
  }

  latestBlock() {
    return this.blocks[this.blocks.length - 1];
  }

  async addBlock(newBlock) {
    let isNew = this.latestBlock().height < newBlock.height ? true : false;
    if (!isNew) return false; // 新規のブロックでない場合はスキップ
    this.validateBlock(newBlock, true);
    this.blocks.push(newBlock);
    await StateStore.applyTransactions(this.statestore, newBlock.txs); // stateの更新
    this.statestore.applyRewards(newBlock.proposer, newBlock.votes); // リワードの付与
    this.pool.clear(this.statestore.clone()); // ペンディングTxsとStatesのクリア
    this.votes = []; // 投票のクリア
    this.pendingBlock = null; // ペンディングBlockのクリア
    console.log(`> ⛓ new block added! height is ${newBlock.height}`);
    return true;
  }

  async validateBlock(b, isApproved = false) {
    const preBlock = this.latestBlock();
    const expectedProposer = this.electProposer(this.statestore.validators(), b.height);
    const statestore = this.statestore.clone();
    await StateStore.applyTransactions(statestore, b.txs);
    const expectedStateRoot = StateStore.computeStateRoot(statestore);
    const expHash = Block.hash(b.height, b.preHash, b.timestamp, b.txs, b.proposer, b.stateRoot, b.votes);
    if (b.height !== preBlock.height + 1) {
      // ブロック高さが直前のブロックの次であるかチェック
      throw new Error(`invalid heigh. expected: ${preBlock.height + 1}`);
    } else if (b.preHash !== preBlock.hash) {
      // 前ブロックハッシュ値が直前のブロックのハッシュ値と一致するかチェック
      throw new Error(`invalid preHash. expected: ${preBlock.hash}`);
    } else if (b.proposer !== expectedProposer) {
      // 正しいブロッックプロポーザーかチェック
      throw new Error(`invalid propoer. expected: ${expectedProposer}`);
    } else if (b.stateRoot !== expectedStateRoot) {
      // StateRootの計算結果が一致するかチェック
      throw new Error(`invalid state root. expected: ${expectedStateRoot}`);
    } else if (b.hash !== expHash) {
      // ハッシュ値が正しいく計算されているかチェック
      throw new Error(`invalid hash. expected: ${expHash}`);
    }
    // 署名が正しいかチェック
    if (!Wallet.validateSig(b.hash, b.signature, b.proposer)) {
      throw new Error(`invalid block signature`);
    }
    // 承認されたブロックの場合は、2/3以上のyesを集めているかチェック
    if (isApproved) {
      if (!this.tallyVotes(b.votes)) {
        throw new Error(`insufficient positive votes`);
      }
    }
  }

  electProposer(validators, height) {
    // 1. ブロック高さのハッシュ値の先頭１byteを決定的な乱数として使う
    const threshold = Number(`0x${SHA256(height.toString()).toString().slice(0, 2)}`);
    // 2. Stake量の総和を計算
    const totalStake = validators.reduce((pre, v) => pre + v.stake, 0);
    let sumOfVotingPower = 0;
    return validators.find((v) => {
      // 3. stake量によって荷重されたVotingPowerを計算stake量によって荷重されたVotingPowerを計算
      //    255で掛けているのは、今回、乱数としてつかった1byteの最大値が255であり、その割合を出すため
      let votingPower = 255 * (v.stake / totalStake);
      sumOfVotingPower += votingPower;
      // 4. 初めてVotingPowerの総和が、ブロック高さから求めた乱数（threshold）を超えた時のバリデータをプロポーザとして選出
      return threshold <= sumOfVotingPower;
    }).key;
  }

  addVote(vote) {
    let isNew = this.latestBlock().height < vote.height ? true : false;
    if (!isNew) return false; // 新規のブロックに対してではない場合は、スキップ
    this.validateVote(vote);
    if (this.votes.find((v) => v.hash === vote.hash)) return false; // 既に存在する場合はスキップ
    this.votes.push(vote);
    return true;
  }

  validateVote(vote) {
    // heightが次のブロックと等しいかチェック
    if (vote.height !== this.latestBlock().height + 1) {
      throw new Error(`invalid height. expected: ${this.latestBlock().height + 1}`);
    }
    // hash値が正しく計算されているかチェック
    const expected = Vote.hash(vote.heigh, vote.blockHash, vote.voter, vote.isYes);
    if (vote.hash !== expected) {
      throw new Error(`invalid vote hash. expected: ${expected}`);
    }
    // 署名が正当かどうかチェック
    if (!Wallet.validateSig(vote.hash, vote.signature, vote.voter)) {
      throw new Error(`invalid signature`);
    }
    // voterがvalidatorかチェック
    if (!this.statestore.validators().find((v) => v.key === vote.voter)) {
      throw new Error(`voter should be validator`);
    }
    // 当該プロックのプロポーザではないことをチェック
    if (vote.voter === this.electProposer(this.statestore.validators(), this.latestBlock().height + 1)) {
      throw new Error(`voter is proposer`);
    }
  }

  tallyVotes() {
    const rate = this.votes.filter((v) => v.isYes).length / (this.statestore.validators().length - 1); // yes投票の割合
    return 2 / 3 <= rate; // yesが2/3以上であれば合格
  }

  generateBlock() {
    const preBlock = this.latestBlock();
    const propoer = StateManager.key(this.wallet.address);
    const stateRoot = StateStore.computeStateRoot(this.pool.pendingStates);
    const b = new Block(preBlock.height + 1, preBlock.hash, now(), this.pool.txs, propoer, stateRoot);
    return this.wallet.signBlock(b);
  }

  isProposer() {
    const validators = this.statestore.validators();
    const nextHeight = this.latestBlock().height + 1;
    return StateManager.key(this.wallet.address) === this.electProposer(validators, nextHeight);
  }

  start(broadcastBlock) {
    setInterval(() => {
      if (!this.isProposer()) return; // 自分がproposerでなければスキップ
      if (this.pendingBlock) return; // 既にブロックをプロポーズ済みならスキップ
      // 自分がproposerならブロックを作ってブロードキャスト
      this.pendingBlock = this.generateBlock();
      broadcastBlock(this.pendingBlock);
      console.log(`proposing ${this.pendingBlock.height} th height of block`);
    }, 3 * 1000); // x秒間隔で実行する
  }
}

class Block {
  constructor(height, preHash, timestamp, txs, proposer, stateRoot, votes = [], sig = "") {
    this.height = height;
    this.preHash = preHash;
    this.timestamp = timestamp;
    this.txs = txs;
    (this.proposer = StateManager.key(proposer)), (this.stateRoot = stateRoot);
    this.votes = votes;
    this.signature = sig;
    this.hash = Block.hash(height, preHash, timestamp, txs, proposer, stateRoot, votes);
  }

  static hash(height, preHash, timestamp, txs, proposer, stateRoot, votes) {
    const txsStr = TxPool.serializeTxs(txs);
    const votesStr = votes.reduce((pre, vote) => pre + vote.toString(), "");
    return SHA256(`${height},${preHash},${timestamp},${txsStr},${proposer},${stateRoot},${votesStr}`).toString();
  }
}

class KV {
  constructor(key, value) {
    this.key = key;
    this.value = value;
  }
}

class KVStore {
  constructor(kvs = []) {
    this.kvs = kvs;
  }

  print() {
    this.kvs.forEach((kv) => console.log(kv));
  }

  get(key) {
    return this.kvs.find((kv) => kv.key === key);
  }

  set(key, value) {
    const newKV = new KV(key, value);
    const i = this.kvs.findIndex((kv) => kv.key === key);
    if (i < 0) {
      this.kvs.push(newKV);
    } else {
      this.kvs[i] = newKV;
    }
  }

  update(oldKey, newKey, value) {
    const newKV = new KV(newKey, value);
    const i = this.kvs.findIndex((kv) => kv.key === oldKey);
    if (i < 0) {
      this.kvs.push(newKV);
    } else {
      this.kvs[i] = newKV;
    }
  }

  clone() {
    return new KVStore(this.kvs.map((kv) => new KV(kv.key, kv.value)));
  }
}

class StateStore {
  constructor(store, accounts) {
    this.store = store;
    this.accounts = accounts;
  }

  validators() {
    const self = this;
    return this.accounts.map((account) => self.accountState(account)).filter((accountState) => 0 < accountState.stake);
  }

  applyRewards(proposer, votes) {
    this.updateBalance(proposer, 30000); // proposerのリワードは”30000”
    for (const vote of votes) {
      if (!vote.isYes) continue;
      this.updateBalance(vote.voter, 10000); // yesに投票したvoterのリワードは”10000”
    }
  }

  decodeAccountState(kv) {
    if (kv.value === emptySlot) return new AccountState(kv.key, 0, 0, 0);
    const a = JSON.parse(kv.value);
    return new AccountState(a.key, a.nonce, a.balance, a.stake, a.storageRoot, a.codeHash);
  }

  encodeAccountState(state) {
    return JSON.stringify(state);
  }

  accountState(address) {
    const addressKey = StateManager.key(address);
    const kv = this.store.get(addressKey);
    if (!kv) return new AccountState(addressKey, 0, 0, 0);
    return this.decodeAccountState(kv);
  }

  setAccountState(address, state) {
    const addressKey = StateManager.key(address);
    this.store.set(addressKey, this.encodeAccountState(state));
    // 新規の場合、アカウントリストに追加
    if (!this.accounts.find((a) => a === addressKey)) this.accounts.push(addressKey);
  }

  balanceOf(address) {
    const addressKey = StateManager.key(address);
    const state = this.accountState(addressKey);
    return state ? state.balance : 0;
  }

  updateBalance(address, amount) {
    const addressKey = StateManager.key(address);
    let state = this.accountState(addressKey);
    if (!state) throw new Error(`failed to reduce balance. not account found by ${addressKey}`);
    state.balance += amount;
    if (state.balance < 0) throw new Error(`balance of ${addressKey} is negative`);
    this.setAccountState(addressKey, state);
  }

  incrementNonce(address) {
    const addressKey = StateManager.key(address);
    let state = this.accountState(addressKey);
    if (!state) throw new Error(`failed to increment nonce. not account found by ${addressKey}`);
    state.nonce++;
    this.setAccountState(addressKey, state);
  }

  async callContract(address, data) {
    const evm = new EVM(this.clone());
    const result = await evm.runCall({
      to: Address.fromString(address),
      data: Buffer.from(data, "hex"),
    });
    return result.execResult.returnValue;
  }

  clone() {
    return new StateStore(this.store.clone(), [...this.accounts]);
  }

  static computeStateRoot(statestore) {
    // StateRootは「全アカウントのstatesを文字列にして繋げたもののhash値」とする
    const serialized = statestore.accounts.reduce((pre, addressKey) => {
      const state = statestore.accountState(addressKey);
      return pre + statestore.encodeAccountState(state);
    }, "");
    return SHA256(serialized).toString();
  }

  static async applyTransactions(statestore, txs) {
    for (const tx of txs) {
      await StateStore.applyTransaction(statestore, tx);
    }
  }

  static async applyTransaction(statestore, tx) {
    let receipt = { status: "pending" };
    let gasUsed;
    if (tx.data.length === 0 && `0x${tx.to}` !== ZeroAddress) {
      // 送金なら
      statestore.updateBalance(tx.from, -tx.amount);
      statestore.updateBalance(tx.to, tx.amount);
      gasUsed = 21000; // 送金トランザクションのガス代は、固定
    } else if (tx.data.length !== 0) {
      // スマートコントラクトの実行なら
      const evm = new EVM(statestore);
      const result = await evm.runCall({
        caller: Address.fromString(`0x${tx.from}`),
        to: `0x${tx.to}` !== ZeroAddress ? Address.fromString(`0x${tx.to}`) : undefined,
        data: tx.data,
        gasLimit: tx.gasLimit,
        gasPrice: tx.gasPrice,
        isStatic: false,
      });
      gasUsed = Number(result.execResult.executionGasUsed);
      if (result.createdAddress) receipt.contract = result.createdAddress.toString("hex");
    } else {
      throw new Error(`invalid tx(=${tx.toString()})`);
    }

    statestore.updateBalance(tx.from, -(gasUsed * Number(tx.gasPrice))); // ガス代を徴収
    statestore.incrementNonce(tx.from); // nonceをインクリメント

    receipt.gasUsed = gasUsed;

    return receipt;
  }
}

class Transaction {
  constructor(from, to, amount, data = "", gasPrice = 1, gasLimit = 16777215, sig = "") {
    this.from = StateManager.key(from);
    this.to = to !== "" ? StateManager.key(to) : StateManager.key(ZeroAddress);
    this.amount = amount;
    this.data = Buffer.from(data, "hex");
    this.gasPrice = BigInt(gasPrice);
    this.gasLimit = BigInt(gasLimit);
    this.signature = sig;
    this.hash = Transaction.hash(this.from, this.to, this.amount, this.data, this.gasPrice, this.gasLimit);
  }

  toString() {
    let txObj = {};
    for (const key in this) {
      if (key === "data") txObj[key] = this[key].toString("hex");
      else txObj[key] = this[key].toString();
    }
    return JSON.stringify(txObj);
  }

  static hash(from, to, amount, data, gasPrice, gasLimit) {
    return SHA256(
      `${from},${to},${amount},${data.toString("hex")},${gasPrice.toString()},${gasLimit.toString()}`
    ).toString();
  }
}

class TxPool {
  constructor(statestore) {
    this.txs = [];
    this.pendingStates = statestore;
  }

  clear(statestore) {
    this.txs = [];
    this.pendingStates = statestore;
  }

  async addTx(tx) {
    TxPool.validateTx(tx, this.pendingStates);
    if (this.txs.find((t) => t.hash === tx.hash)) return false; // 新規のTxではない
    const receipt = await StateStore.applyTransaction(this.pendingStates, tx);
    this.txs.push(tx);
    return receipt;
  }

  static validateTx(tx, states) {
    // hash値が正しく計算されているかチェック
    const expectedHash = Transaction.hash(tx.from, tx.to, tx.amount, tx.data, tx.gasPrice, tx.gasLimit);
    if (tx.hash !== expectedHash) {
      throw new Error(`invalid tx hash. expected: ${expectedHash}`);
    }
    // 署名が正当かどうかチェック
    if (!Wallet.validateSig(tx.hash, tx.signature, tx.from)) {
      throw new Error(`invalid signature`);
    }
    // 送金額が残高以下であるかチェック
    const balance = states.balanceOf(tx.from);
    if (balance < tx.amount) {
      throw new Error(`insufficient fund(=${balance})`);
    }
  }

  static serializeTxs(txs) {
    return txs.reduce((pre, tx) => pre + tx.toString(), "");
  }
}

class Vote {
  constructor(height, blockHash, addr, isYes, sig = "") {
    this.height = height;
    this.blockHash = blockHash;
    this.voter = StateManager.key(addr);
    this.isYes = isYes;
    this.signature = sig;
    this.hash = Vote.hash(this.heigh, this.blockHash, this.voter, this.isYes);
  }

  toString() {
    return JSON.stringify(this);
  }

  static hash(height, blockHash, voter, isYes) {
    return SHA256(`${height},${blockHash},${voter},${isYes}`).toString();
  }
}

class Wallet {
  constructor(key) {
    this._wallet = key ? web3.eth.accounts.privateKeyToAccount(key) : web3.eth.accounts.create();
    this.priKey = this._wallet.privateKey;
    this.address = this._wallet.address.toLowerCase();
  }
  // トランザクションに署名する関数
  signTx(tx) {
    tx.signature = web3.eth.accounts.sign(tx.hash, this.priKey).signature;
    return tx;
  }
  // 投票に署名する関数
  signVote(vote) {
    vote.signature = web3.eth.accounts.sign(vote.hash, this.priKey).signature;
    return vote;
  }
  // Blockに署名する関数
  signBlock(block) {
    block.signature = web3.eth.accounts.sign(block.hash, this.priKey).signature;
    return block;
  }

  static validateSig(message, signature, expected) {
    const exp = expected.startsWith("0x") ? expected : `0x${expected}`;
    return web3.eth.accounts.recover(message, signature).toLowerCase() === exp;
  }
}

module.exports = { Block, Tinychain, Transaction, Wallet, Vote, KV, KVStore, StateStore };
