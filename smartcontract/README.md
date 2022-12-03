# スマートコントラクトが動くチェーンを作る

前回作った POS のチェーンをスマートコントラクトが動くように拡張します。世の中にはいくつかのスマートコントラクト基盤が存在します。javascript と相性のよい WASM 系のコントラクトでも構いませんが、最もポピュラーな Ethereum を採用しました。Ethereum なら javascript の VM があるのでシームレスにチェーンと統合可能です。

## スマートコントラクトどのように動くのか？

Ethereum のスマートコントラクトは EVM という仮想マシン上で動作します。仮想とは、Linux や Windows が動く物理マシンと対比した表現で、物理マシン上で仮想的に構築した環境で動く物理マシンのようなマシンを仮想マシンといいます。例えば Java の JVM が仮想マシンです。Java は OS に左右されない言語という特徴がありますが、これは JVM のおかげです。Java 以外の C とか Rust のような言語は、OS 毎にコンパイルする必要があります。これは、CPU や OS ごとに解釈できる機械語が異なることに起因します。一方、仮想マシンはこのような物理マシンの差異を吸収するのが仮想マシンの役割で、仮想マシン自体は物理マシン毎にもうける必要があるものの、その上で動作するプログラムは、どの環境にも依存しません。なので、Ethereum のスマートコントラクトも、MAC であろうが、Windows であろうが、どの環境でも動作します。

Ethereum は様々な言語の EVM が存在しますが、Tinychain が Javascript で実装されているので、[Javascript 製の EVM](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/evm)を使います。通常のプログラムの場合、データの格納先は主にそのプログラムが動作するコンピュータのストレージです。一方、スマートコントラクトの場合は、ブロックチェーンに格納する必要があります。Tinychain とスマートコントラクトとの統合は、言い換えると、**EVM がデータを格納するときの I/O に合わせて、Tinychain 側の I/O を整えていく作業**です。

## ブロックチェーンのデータストア

Bitcoin や Ethereum 等の主要なブロックチェーンでは、データストアとして「Key-Value ストア」を使います。
Key-Value ストアは、key に対応する value を格納するだけのシンプルなストアで、シンプルゆえに高速で動作するという特徴があります。反面、SQL のような柔軟なデータ検索ができません。普通の Web アプリの場合は、シビアなパフォーマンスを要求されないのでデータ検索しやすい、Mysql や MongoDB 等のデータベース管理システムが採用されます。一方、TPS に代表されるようにパフォーマンスが重視されるブロックチェーンでは、Key-Value ストアが使われることが多いです。実は、データベース管理システムは内部で Key-Value ストアを使っていることが多いので、ブロックチェーンが Mysql や MongoDB のようなデータベース管理システムを兼ねています。ブロックチェーンは分散型のデータベースなのです。

### Tinychain のデータストア

Tinychain の Key-Value ストアは、配列に Key と Value のペアを格納するシンプルな形で実装しています。

```javascript
// KeyとValueのペア
class KV {
  constructor(key, value) {
    this.key = key;
    this.value = value;
  }
}

// Key-Valueストア
class KVStore {
  constructor(kvs = []) {
    this.kvs = kvs; // KVをインメモリの配列で持つ
  }
  ...
```

### 具体例

具体的に、ここにデプロイしたコントラクトがどのような形で格納されるのか見てみます。
今回デプロイするのは、非常にシンプルな[Greeter.sol](./contract/Greeter.sol)です。

Greeter コントラクトの関数

- `setGreeting`「挨拶（何かしらの文字列）」を格納する
- `greet` 挨拶を確認できる。デプロイ時に指定。変更可能。
- `counter` 挨拶を変更した回数を確認できる。初期値は１

コントラクトをデプロイするとこのような形で格納されます。

```javascript
// Greeterコントラクトアカウント。コントラクトアドレスがKey。
KV {
  key: '61de9dc6f6cff1df2809480882cfd3c2364b28f7',
  value: '{"key":"61de9dc6f6cff1df2809480882cfd3c2364b28f7","nonce":1,"balance":0,"stake":0,"storageRoot":"f6d722eefaa6e8cf383a264e5e68af74a532f146976a5f23849cc9b5d6be3840","codeHash":"1a0f9112ed2bc76b7ebd1c289d7a38cd7b57f3b1cf0a2ef5e6cb5b3767eb0c09"}'
}

// コントラクトのStateRoot。Greeterコントラクトアカウントの"storageRoot"に対応
KV {
  key: 'f6d722eefaa6e8cf383a264e5e68af74a532f146976a5f23849cc9b5d6be3840',
  value: 'deaa3c143a02c0b3443772e45a30e892bcdba63b4f616d557768e01942003ca2|ba186fd0e47744418e1241d37e79f17976f0059befaccd601112c583c105aa2e'
}

// "greet"が格納される
KV {
  key: 'deaa3c143a02c0b3443772e45a30e892bcdba63b4f616d557768e01942003ca2',
  value: '48656c6c6f2c20576f726c64210000000000000000000000000000000000001a'
}

// "counter"が格納される
KV {
  key: 'ba186fd0e47744418e1241d37e79f17976f0059befaccd601112c583c105aa2e',
  value: '01'
}

// コントラクトのbytecodeが格納される。このハッシュ値がkeyとなり、Greeterコントラクトアカウントの"codeHash"に対応
KV {
  key: '1a0f9112ed2bc76b7ebd1c289d7a38cd7b57f3b1cf0a2ef5e6cb5b3767eb0c09',
  value: '608060405234801561001057600080fd5b50600436106100415760003560e01c806361bc221a14610046578063a413686214610062578063cfae321714610077575b600080fd5b61004f60015481565b6040519081526020015b60405180910390f35b61007561007036600461015a565b61008c565b005b61007f6100b2565b604051610059919061020b565b6001805490600061009c83610259565b90915550600090506100ae8282610309565b5050565b6060600080546100c190610280565b80601f01602080910402602001604051908101604052809291908181526020018280546100ed90610280565b801561013a5780601f1061010f5761010080835404028352916020019161013a565b820191906000526020600020905b81548152906001019060200180831161011d57829003601f168201915b5050505050905090565b634e487b7160e01b600052604160045260246000fd5b60006020828403121561016c57600080fd5b813567ffffffffffffffff8082111561018457600080fd5b818401915084601f83011261019857600080fd5b8135818111156101aa576101aa610144565b604051601f8201601f19908116603f011681019083821181831017156101d2576101d2610144565b816040528281528760208487010111156101eb57600080fd5b826020860160208301376000928101602001929092525095945050505050565b600060208083528351808285015260005b818110156102385785810183015185820160400152820161021c565b506000604082860101526040601f19601f8301168501019250505092915050565b60006001820161027957634e487b7160e01b600052601160045260246000fd5b5060010190565b600181811c9082168061029457607f821691505b6020821081036102b457634e487b7160e01b600052602260045260246000fd5b50919050565b601f82111561030457600081815260208120601f850160051c810160208610156102e15750805b601f850160051c820191505b81811015610300578281556001016102ed565b5050505b505050565b815167ffffffffffffffff81111561032357610323610144565b610337816103318454610280565b846102ba565b602080601f83116001811461036c57600084156103545750858301515b600019600386901b1c1916600185901b178555610300565b600085815260208120601f198616915b8281101561039b5788860151825594840194600190910190840161037c565b50858210156103b95787850151600019600388901b60f8161c191681555b5050505050600190811b0190555056fea2646970667358221220141cddc07bdc2feb90dc1470d8ffb783717ff9dbc09c1634cc56d81c470bb0a264736f6c63430008110033'
}
```

最初の KV がコントラクトのアカウントデータに相当するものです。Key 値がコントラクトのアドレスで、コントラクトのアカウント State を Value で持っています。アカウント State は前回のものに３つ新たなフィールドを追加しています。

- `nonce`: トランザクションの度にインクリメントします
- `storageRoot`: コントラクトが持っている全ての状態の Root 値に相当するものです。EOA（秘密鍵を持つ、普通のユーザアカウント）の場合は、空値に相当するデータが入ります
- `codeHash`: コントラクトの bytecode のハッシュ値が入ります。EOA の場合は、空値に相当するデータが入ります

```javascript
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
  ...
```

２番目の KV が storageRoot です。Greeter コントラクトの持っている`greeting`と`counter`の２つの変数に対応する Key を`|`で分割された形で Value に持っています。

３、４番目の KV が`greeting`と`counter`変数に対応する Value です。

最後の KV がコントラクトの bytecode です。このハッシュ値が Key となり、`codeHash`に格納されます。

ご覧の通り全ての Key が 32bytes です。これは、EVM のコンピュータモデルが 32bytes のスタックマシーンであることに起因します。

### EVM との I/O

EVM が外部環境へアクセスするときの I/O は[EEIInterface](https://github.com/ethereumjs/ethereumjs-monorepo/blob/%40ethereumjs/evm%401.2.2/packages/evm/src/types.ts#L29)にまとめられています。

```javascript
export interface EEIInterface extends EVMStateAccess {
  getBlockHash(num: bigint): Promise<bigint>
  storageStore(address: Address, key: Buffer, value: Buffer): Promise<void>
  storageLoad(address: Address, key: Buffer, original: boolean): Promise<Buffer>
  copy(): EEIInterface
}

export interface EVMStateAccess extends StateAccess {
  addWarmedAddress(address: Buffer): void
  isWarmedAddress(address: Buffer): boolean
  addWarmedStorage(address: Buffer, slot: Buffer): void
  isWarmedStorage(address: Buffer, slot: Buffer): boolean
  clearWarmedAccounts(): void
  generateAccessList?(addressesRemoved: Address[], addressesOnlyStorage: Address[]): AccessList
  clearOriginalStorageCache(): void
  cleanupTouchedAccounts(): Promise<void>
  generateCanonicalGenesis(initState: any): Promise<void>
}

interface StateAccess {
  accountExists(address: Address): Promise<boolean>
  getAccount(address: Address): Promise<Account>
  putAccount(address: Address, account: Account): Promise<void>
  accountIsEmpty(address: Address): Promise<boolean>
  deleteAccount(address: Address): Promise<void>
  modifyAccountFields(address: Address, accountFields: AccountFields): Promise<void>
  putContractCode(address: Address, value: Buffer): Promise<void>
  getContractCode(address: Address): Promise<Buffer>
  getContractStorage(address: Address, key: Buffer): Promise<Buffer>
  putContractStorage(address: Address, key: Buffer, value: Buffer): Promise<void>
  clearContractStorage(address: Address): Promise<void>
  checkpoint(): Promise<void>
  commit(): Promise<void>
  revert(): Promise<void>
  getStateRoot(): Promise<Buffer>
  setStateRoot(stateRoot: Buffer): Promise<void>
  getProof?(address: Address, storageSlots: Buffer[]): Promise<Proof>
  verifyProof?(proof: Proof): Promise<boolean>
  hasStateRoot(root: Buffer): Promise<boolean>
}
```

Tinychain は、この内の一部を実装しています。Greeter コントラクトは単純なので、全てを実装する必要がありません。複雑なコントラクトを動かしたい場合は、この内の多くを実装する必要が出てくるはずです。

### Tinychain で実装した I/O

Tinychain で EEIInterface を実装したクラスが`StateManager`です。
実装したメソッドとその役割をピックアップして解説します。

- `getAccount`: EVM が指定する[Account](https://github.com/ethereumjs/ethereumjs-monorepo/blob/%40ethereumjs/evm%401.2.2/packages/util/src/account.ts#L32)型のアカウントを返却する
- `putAccount`: Account 型のデータを格納する
- `isWarmedStorage`: ストレージが初期化されているかチェックする。Key-Value ストアに該当の Key が存在するかチェック
- `addWarmedStorage`: Slot に初期データを挿入する。Key-Value ストアの Key に初期 Value を入れる。Slot については[Layout of State Variables in Storage](https://docs.soliditylang.org/en/v0.8.17/internals/layout_in_storage.html#layout-of-state-variables-in-storage)を参照
- `storageLoad`: ストレージからデータを読み込出す。Key-Value ストアの Key に対応する Value を取り出す
- `storageStore`: ストレージにデータを格納する。Key-Value ストアの Key に Value を入れる
- `getContractCode`: コントラクトの bytecode を読み出す。Key が codeHash で Value が bytecode
- `putContractCode`: コントラクトの bytecode を格納する

## Wallet を Bitcoin 型から Ethereum 型に変更

その他の大きな変更点として、Wallet を Bitcoin 型から Ethereum 型に変更しました。そのまま Bitcoin 型を使い続けることも可能でしたが、EVM と統合する都合上、Ethereum 型に変更するのが自然だったので、リプレイスしました。

```javascript
class Wallet {
  constructor(key) {
    this._wallet = key ? web3.eth.accounts.privateKeyToAccount(key) : web3.eth.accounts.create();
    this.priKey = this._wallet.privateKey;
    this.address = this._wallet.address.toLowerCase();
  }
  ...
```

## 動作確認

実際に Greeter コントラクトを Deploy して、値を変更することを通じて動作確認します。

- Step1: Step1: Alice, Bob, Tom をバリデータとしてブロックチェーンを起動
- Step2: Alice が Greeter コントラクトをデプロイ
- Step3: Greet と Counter の値を取得する
- Step4: Bob の残高を確認

### Step1: Alice, Bob, Tom をバリデータとしてブロックチェーンを起動

それぞれ、起動します。

```sh
# alice
node server.js chain --wallet ./wallet/privkey-alice -p 3001 --p2p-port 5001
# bob
node server.js chain --wallet ./wallet/privkey-bob -p 3002 --p2p-port 5002 --p2p-endpoints ws://127.0.0.1:5001
# tom
node server.js chain --wallet ./wallet/privkey-tom -p 3003 --p2p-port 5003 --p2p-endpoints ws://127.0.0.1:5001
```

Alice の残高を確認します。

```sh
node client.js balance -p 3001 0x9e6aba2bfd33c4919171712e25f52d2fae0edcd0
```

### Step2: Alice が Greeter コントラクトをデプロイ

まず、コントラクトを deploy するための calldata を作成します。
動作確認で実行するすべての calldata を[greeter.js](./contract/greeter.js)にまとめてあるので、こちらを実行します。

```sh
node contract/greeter.js
```

実行すると、`deploy calldata: 0x6080604052348015....`というバイトコードが生成されます。これが、calldata です。
この calldata は`contractのbytecode`+`constructorの引数`の構成です。

デプロイのコマンドはこちらです。

```sh
node client.js contract-send -w ./wallet/privkey-alice 0x6080604052348015...
```

### Step3: Greet と Counter の値を取得する

コントラクトが正しく Deploy されているか確認するために、Greet と Counter の値を取得してみます。

```sh
# greet
node client.js contract-call -c 0x34f353e3437c9352d15a1693180b918f437639e5 0xcfae3217

# counter
node client.js contract-call -c 0x34f353e3437c9352d15a1693180b918f437639e5 0x61bc221a
```

### Step4: Greet の内容を変更する

最後に、Deploy したコントラクトの値を変更して、値が変更されているか確認します。

```sh
# set greet
node client.js contract-send -w ./wallet/privkey-alice -c 0x34f353e3437c9352d15a1693180b918f437639e5 0xa41368620000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000c486f772061726520796f753f0000000000000000000000000000000000000000

# greet
node client.js contract-call -c 0x34f353e3437c9352d15a1693180b918f437639e5 0xcfae3217
```
