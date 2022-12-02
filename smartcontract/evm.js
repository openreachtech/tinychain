"use strict";

const { Chain, Common, Hardfork } = require("@ethereumjs/common");
const { KECCAK256_NULL_S } = require("@ethereumjs/util");
const { EVM: ETHEVM } = require("@ethereumjs/evm");
const SHA256 = require("crypto-js/sha256");
const { Account } = require("@ethereumjs/util");
const { emptySlot } = require("./utils");

class EVM {
  constructor(statestore) {
    this.evm = new ETHEVM({
      common: new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London }),
      eei: new StateManager(statestore),
    });
  }

  async runCall(opts) {
    return await this.evm.runCall(opts);
  }
}

class AccountState {
  constructor(address, nonce = 0, balance, stake = 0, storageRoot = emptySlot, codeHash = KECCAK256_NULL_S) {
    const addressKey = StateManager.key(address);
    this.key = addressKey; // addressをkeyとして使う
    this.nonce = nonce;
    this.balance = balance;
    this.stake = stake; // stakeは簡略化のためGenesisStateからのみ設定する
    this.storageRoot = storageRoot;
    this.codeHash = codeHash;
  }

  static codeHash(code) {
    return SHA256(`${code}`).toString();
  }
}

// EEIInterfaceを実装したクラス
// https://github.com/ethereumjs/ethereumjs-monorepo/blob/%40ethereumjs/evm%401.2.2/packages/evm/src/types.ts#L29
class StateManager {
  constructor(statestore) {
    this.statestore = statestore;
    this._modifies = [];
  }

  // EVMが指定するAccount型のアカウントを返却する
  // https://github.com/ethereumjs/ethereumjs-monorepo/blob/%40ethereumjs/evm%401.2.2/packages/util/src/account.ts#L32
  async getAccount(address) {
    const state = this.statestore.accountState(StateManager.key(address));
    return new Account(
      BigInt(state.nonce),
      BigInt(state.balance),
      Buffer.from(state.storageRoot, "hex"),
      Buffer.from(state.codeHash, "hex")
    );
  }

  // Account型のデータを格納する
  async putAccount(address, account) {
    const addressKey = StateManager.key(address);
    const accountState = this.statestore.accountState(addressKey);
    const newAccountState = new AccountState(
      addressKey,
      Number(account.nonce),
      Number(account.balance),
      accountState.stake,
      account.storageRoot.toString("hex"),
      account.codeHash.toString("hex")
    );
    this.statestore.setAccountState(addressKey, newAccountState);
  }

  // ストレージが初期化されているかチェックする。Key-Valueストアに該当のKeyが存在するかチェック
  isWarmedStorage(address, slot) {
    const storageKey = this.storageKey(address, slot);
    const kv = this.statestore.store.get(storageKey);
    if (!kv) return false;
    return true;
  }

  // Slotに初期データを挿入する。Key-ValueストアのKeyに初期Valueを入れる
  addWarmedStorage(address, slot) {
    const storageKey = this.storageKey(address, slot);
    this.statestore.store.set(storageKey, emptySlot);
  }

  // アカウントに対応するKVを初期化
  addWarmedAddress(address) {
    this.statestore.store.set(StateManager.key(address), emptySlot);
  }

  async clearContractStorage(address) {
    this._modifies = [];
  }

  // ストレージからデータを読み込出す。Key-ValueストアのKeyに対応するValueを取り出す
  async storageLoad(address, key, original = false) {
    const storageKey = this.storageKey(address, key);
    const kv = this.statestore.store.kvs.find((kv) => kv.key === storageKey);
    if (!kv) return Buffer.from(emptySlot, "hex");
    return Buffer.from(kv.value, "hex");
  }

  // ストレージにデータを格納する。Key-ValueストアのKeyにValueを入れる
  async storageStore(address, key, value) {
    const storageKey = this.storageKey(address, key);
    this.statestore.store.set(storageKey, value.toString("hex"));
    this._modifies.push(storageKey);
    await this._modifyContractStorage(address);
  }

  // コントラクトのbytecodeを読み出す。KeyがcodeHashでValueがbytecode
  async getContractCode(address) {
    const addressKey = StateManager.key(address);
    const state = this.statestore.accountState(addressKey);
    const kv = this.statestore.store.get(state.codeHash);
    if (!kv) throw new Error(`not code found by ${state.codeHash}`);
    return Buffer.from(kv.value, "hex");
  }

  // コントラクトのbytecodeを格納する
  async putContractCode(address, value) {
    const addressKey = StateManager.key(address);
    const codeHash = AccountState.codeHash(value.toString("hex"));
    const kv = this.statestore.store.get(addressKey);
    let state;
    if (kv) {
      state = this.statestore.decodeAccountState(kv);
      state.codeHash = codeHash;
    } else {
      state = new AccountState(addressKey, 0, 0, 0, emptySlot, codeHash);
    }
    // contractアカウントを更新
    this.statestore.store.set(addressKey, this.statestore.encodeAccountState(state));
    // コントラクト自体をKVストアに格納
    this.statestore.store.set(codeHash, value.toString("hex"));
  }

  // 呼び出されるが何もしない
  async checkpoint() {}
  async revert() {}
  async commit() {}

  async _modifyContractStorage(address) {
    const addressKey = StateManager.key(address);
    const state = this.statestore.accountState(addressKey);
    const root = state.storageRoot;
    let keys = [];
    if (root === emptySlot) {
      keys.push(...this._modifies);
    } else {
      const kv = this.statestore.store.get(root);
      keys.push(...kv.value.split("|"));
      this._modifies.forEach((k) => {
        if (keys.find((key) => key === k)) return;
        keys.push(k);
      });
    }

    const serialized = keys
      .reduce((pre, key) => {
        const kv = this.statestore.store.get(key);
        return (pre += `${kv.key},${kv.value}|`);
      }, "")
      .slice(0, -1);

    // storage rootの更新
    const newRoot = SHA256(`${serialized}`).toString();
    const value = keys.reduce((pre, key) => pre + key + "|", "").slice(0, -1);
    this.statestore.store.update(root, newRoot, value);

    // コントラクトアカウントのstorage rootを更新
    state.storageRoot = newRoot;
    this.statestore.setAccountState(addressKey, state);
  }

  storageKey(address, key) {
    return SHA256(`${StateManager.key(address)}|${key.toString("hex")}`).toString();
  }

  static key(address) {
    const k = address.toString("hex");
    if (!k.startsWith("0x")) return k;
    return k.substring(2, k.length);
  }
}

module.exports = { StateManager, AccountState, EVM };
