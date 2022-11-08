"use strict";

const { defaultAbiCoder: AbiCoder, Interface } = require("@ethersproject/abi");
const { Address } = require("@ethereumjs/util");
const { KVStore, AccountState, StateStore } = require("./blockchain");
const { StateManager, EVM } = require("./evm");
const { encodeDeployment, encodeFunction, compileContract } = require("./utils");

// const getAddressKey = (address) => {
//   const addressKey = address.toString("hex");
//   if (!addressKey.startsWith("0x")) return addressKey;
//   return addressKey.substring(2, addressKey.lenght);
// };

const INITIAL_GREETING = "Hello, World!";
const SECOND_GREETING = "Hola, Mundo!";

async function main() {
  /* -----------------------------
    Deploy
   ----------------------------- */
  const bytecode = compileContract("./smartcontract", "Greeter.sol");

  const calldata = encodeDeployment(bytecode, {
    types: ["string"],
    values: [INITIAL_GREETING],
  });
  const data = Buffer.from(calldata, "hex");
  const gasLimit = BigInt(0xffffff);

  const accountPk = Buffer.from("e331b6d69882b4cb4ea581d88e0b604039a3de5967688d3dcffdd2270c0fd109", "hex");
  const accountAddress = Address.fromPrivateKey(accountPk);

  const kvstore = new KVStore();
  const statestore = new StateStore(kvstore);
  statestore.setAccountState(
    StateManager.key(accountAddress),
    new AccountState(accountAddress.toString("hex"), 0, 1000000, 0)
  );

  const evm = new EVM(statestore);

  let result = await evm.runCall({
    data,
    gasLimit,
    caller: accountAddress,
    gasPrice: BigInt(1),
    isStatic: false,
  });

  const contractAddress = result.createdAddress;

  statestore.updateBalance(StateManager.key(accountAddress), -Number(result.execResult.executionGasUsed));
  statestore.incrementNonce(StateManager.key(accountAddress));

  statestore.store.print();

  /* -----------------------------
    Get
   ----------------------------- */
  const sigHash = new Interface(["function greet()"]).getSighash("greet");
  result = await evm.runCall({
    to: contractAddress,
    caller: accountAddress,
    data: Buffer.from(sigHash.slice(2), "hex"),
  });

  let greeting = AbiCoder.decode(["string"], result.execResult.returnValue);
  console.log(greeting);

  /* -----------------------------
    Set
   ----------------------------- */
  const setcalldata = encodeFunction("setGreeting", {
    types: ["string"],
    values: [SECOND_GREETING],
  });

  await evm.runCall({
    to: contractAddress,
    caller: accountAddress,
    data: Buffer.from(setcalldata.slice(2), "hex"),
  });

  result = await evm.runCall({
    to: contractAddress,
    caller: accountAddress,
    data: Buffer.from(sigHash.slice(2), "hex"),
  });

  greeting = AbiCoder.decode(["string"], result.execResult.returnValue);
  console.log(greeting);

  // statestore.store.print();
}

// const generateContractAddress = (address, account) => {
//   return new Address(generateAddress(address.buf, bigIntToBuffer(account.nonce)));
// };

main();
