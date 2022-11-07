"use strict";

const SHA256 = require("crypto-js/sha256");
const { Account, KECCAK256_NULL_S } = require("@ethereumjs/util");

const emptySlot = "0000000000000000000000000000000000000000000000000000000000000000";


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
}

class AccountState {
  constructor(addressKey, nonce = 0, balance, stake = 0, storageRoot = emptySlot, codeHash = KECCAK256_NULL_S) {
    this.key = addressKey; // walletのpubkeyをkeyとして使う
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

class StateStore {
  constructor(store) {
    this.store = store;
  }

  decodeAccountState(kv) {
    if (kv.value === emptySlot) return new AccountState("0x" + kv.key, 0, 0, 0);
    const a = JSON.parse(kv.value);
    return new AccountState(a.key, a.nonce, a.balance, a.stake, a.storageRoot, a.codeHash);
  }

  encodeAccountState(state) {
    return JSON.stringify(state);
  }

  accountState(addressKey) {
    const kv = this.store.get(addressKey);
    if (!kv) return new AccountState(addressKey, 0, 0, 0);
    return this.decodeAccountState(kv);
  }

  setAccountState(addressKey, state) {
    this.store.set(addressKey, this.encodeAccountState(state));
  }

  updateBalance(addressKey, amount) {
    let state = this.accountState(addressKey);
    if (!state) throw new Error(`failed to reduce balance. not account found by ${addressKey}`);
    state.balance += amount;
    if (state.balance < 0) throw new Error(`balance of ${addressKey} is negative`);
    this.setAccountState(addressKey, state);
  }

  incrementNonce(addressKey) {
    let state = this.accountState(addressKey);
    if (!state) throw new Error(`failed to increment nonce. not account found by ${addressKey}`);
    state.nonce++;
    this.setAccountState(addressKey, state);
  }
}

class CustumEEI {
  constructor(statestore) {
    this.statestore = statestore;
    this._modifies = [];
  }

  async getAccount(address) {
    const state = this.statestore.accountState(CustumEEI.key(address));
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
    const addressKey = CustumEEI.key(address);
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
    return SHA256(`${CustumEEI.key(address)}|${key.toString("hex")}`).toString();
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
    this.statestore.store.set(CustumEEI.key(address), emptySlot);
  }

  async checkpoint() {}
  async revert() {}
  async commit() {}

  async clearContractStorage(address) {
    console.log(`clear storage of ${CustumEEI.key(address)}`);
    this._modifies = [];
  }

  async _modifyContractStorage(address) {
    // const i = this.statestore.store.kvs.findIndex((kv) => kv.key === CustumEEI.key(address));
    // if (i < 0) throw new Error(`no account found while clearing contract storage`)
    const addressKey = CustumEEI.key(address);
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
        if (keys.find(key => key === k)) return;
        this.keys.push(k);
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
    const addressKey = CustumEEI.key(address);
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
    const addressKey = CustumEEI.key(address);
    const state = this.statestore.accountState(addressKey);
    const kv = this.statestore.store.get(state.codeHash);
    if (!kv) throw new Error(`not code found by ${state.codeHash}`);
    return Buffer.from(kv.value, "hex");
  }
}

module.exports = { emptySlot, KV, KVStore, AccountState, StateStore, CustumEEI };
