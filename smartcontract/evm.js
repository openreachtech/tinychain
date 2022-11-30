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

class StateManager {
  constructor(statestore) {
    this.statestore = statestore;
    this._modifies = [];
  }

  async getAccount(address) {
    const state = this.statestore.accountState(StateManager.key(address));
    return new Account(
      BigInt(state.nonce),
      BigInt(state.balance),
      Buffer.from(state.storageRoot, "hex"),
      Buffer.from(state.codeHash, "hex")
    );
  }

  static key(address) {
    const k = address.toString("hex");
    if (!k.startsWith("0x")) return k;
    return k.substring(2, k.length);
  }

  async putAccount(address, account) {
    const addressKey = StateManager.key(address);
    const state = this.getAccount(address);
    const newState = new AccountState(
      addressKey,
      Number(account.nonce),
      Number(account.balance),
      state.stake,
      account.storageRoot.toString("hex"),
      account.codeHash.toString("hex")
    );
    this.statestore.setAccountState(addressKey, newState);
  }

  storageKey(address, key) {
    return SHA256(`${StateManager.key(address)}|${key.toString("hex")}`).toString();
  }

  isWarmedStorage(address, slot) {
    // console.log(address.toString("hex"), slot.toString("hex"))
    const storageKey = this.storageKey(address, slot);
    const kv = this.statestore.store.get(storageKey);
    if (!kv) return false;
    return true;
  }

  addWarmedStorage(address, slot) {
    // コントラクトのstorage slotに対応するKVを初期化
    const storageKey = this.storageKey(address, slot);
    this.statestore.store.set(storageKey, emptySlot);
  }

  addWarmedAddress(address) {
    // アカウントに対応するKVを初期化
    this.statestore.store.set(StateManager.key(address), emptySlot);
  }

  async checkpoint() {}
  async revert() {}
  async commit() {}

  async clearContractStorage(address) {
    // console.log(`clear storage of ${StateManager.key(address)}`);
    this._modifies = [];
  }

  async _modifyContractStorage(address) {
    // const i = this.statestore.store.kvs.findIndex((kv) => kv.key === StateManager.key(address));
    // if (i < 0) throw new Error(`no account found while clearing contract storage`)
    const addressKey = StateManager.key(address);
    // const account = await this.getAccount(address);
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

    // console.log(serialized);

    // storage rootの更新
    const newRoot = SHA256(`${serialized}`).toString();
    const value = keys.reduce((pre, key) => pre + key + "|", "").slice(0, -1);
    this.statestore.store.update(root, newRoot, value);

    // コントラクトアカウントのstorage rootを更新
    state.storageRoot = newRoot;
    this.statestore.setAccountState(addressKey, state);
  }

  async storageLoad(address, key, original = false) {
    const storageKey = this.storageKey(address, key);
    const kv = this.statestore.store.kvs.find((kv) => kv.key === storageKey);
    if (!kv) return Buffer.from(emptySlot, "hex");
    return Buffer.from(kv.value, "hex");
  }

  async storageStore(address, key, value) {
    // console.log(address.toString("hex"), key.toString("hex"), value.toString("hex"));
    const storageKey = this.storageKey(address, key);
    this.statestore.store.set(storageKey, value.toString("hex"));
    this._modifies.push(storageKey);
    await this._modifyContractStorage(address);
  }

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

  async getContractCode(address) {
    const addressKey = StateManager.key(address);
    const state = this.statestore.accountState(addressKey);
    const kv = this.statestore.store.get(state.codeHash);
    if (!kv) throw new Error(`not code found by ${state.codeHash}`);
    return Buffer.from(kv.value, "hex");
  }
}

module.exports = { StateManager, AccountState, EVM };
