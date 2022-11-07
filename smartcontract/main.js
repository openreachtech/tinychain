"use strict";

const { readFileSync } = require("fs");
const { EVM } = require("@ethereumjs/evm");
const { Chain, Common, Hardfork } = require("@ethereumjs/common");
const { defaultAbiCoder: AbiCoder, Interface } = require("@ethersproject/abi");
const { Address, generateAddress, bigIntToBuffer } = require("@ethereumjs/util");
const solc = require("solc");
const { KVStore, AccountState, StateStore, CustumEEI } = require("./evm");

// const getAddressKey = (address) => {
//   const addressKey = address.toString("hex");
//   if (!addressKey.startsWith("0x")) return addressKey;
//   return addressKey.substring(2, addressKey.lenght);
// };

const INITIAL_GREETING = "Hello, World!";
const SECOND_GREETING = "Hola, Mundo!";

const encodeDeployment = (bytecode, params) => {
  const deploymentData = bytecode;
  if (params) {
    const argumentsEncoded = AbiCoder.encode(params.types, params.values);
    return deploymentData + argumentsEncoded.slice(2);
  }
  return deploymentData;
};

const encodeFunction = (method, params) => {
  const parameters = params.types ?? []
  const methodWithParameters = `function ${method}(${parameters.join(',')})`
  const signatureHash = new Interface([methodWithParameters]).getSighash(method)
  const encodedArgs = AbiCoder.encode(parameters, params.values ?? [])
  return signatureHash + encodedArgs.slice(2)
}

const compileContract = (dir, file) => {
  const input = {
    language: "Solidity",
    sources: {
      "Greeter.sol": {
        content: readFileSync(`${dir}/${file}`, "utf8"),
      },
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "petersburg",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode"],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  let compilationFailed = false;

  if (output.errors) {
    for (const error of output.errors) {
      if (error.severity === "error") {
        console.error(error.formattedMessage);
        compilationFailed = true;
      } else {
        console.warn(error.formattedMessage);
      }
    }
  }

  if (compilationFailed) {
    return undefined;
  }

  console.log()
  return output.contracts[file][file.slice(0,-4)].evm.bytecode.object;
}

async function main() {
  /* -----------------------------
    Deploy
   ----------------------------- */
  const bytecode = compileContract("./smartcontract", "Greeter.sol")
  
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
  statestore.setAccountState(CustumEEI.key(accountAddress), new AccountState(accountAddress.toString("hex"), 0, 1000000, 0));
  const eei = new CustumEEI(statestore);

  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London });
  const evm = new EVM({
    common,
    eei,
  });

  let result = await evm.runCall({
    data,
    gasLimit,
    caller: accountAddress,
    gasPrice: BigInt(1),
    isStatic: false,
  });

  const contractAddress = result.createdAddress

  statestore.updateBalance(CustumEEI.key(accountAddress), -Number(result.execResult.executionGasUsed));
  statestore.incrementNonce(CustumEEI.key(accountAddress));

  statestore.store.print();

  /* -----------------------------
    Get
   ----------------------------- */
  const sigHash = new Interface(['function greet()']).getSighash('greet')
  result = await evm.runCall({
    to: contractAddress,
    caller: accountAddress,
    data: Buffer.from(sigHash.slice(2), 'hex'),
  })

  let greeting = AbiCoder.decode(['string'], result.execResult.returnValue)
  console.log(greeting)

  /* -----------------------------
    Set
   ----------------------------- */
   const setcalldata = encodeFunction('setGreeting', {
    types: ['string'],
    values: [SECOND_GREETING],
  })

  await evm.runCall({
    to: contractAddress,
    caller: accountAddress,
    data: Buffer.from(setcalldata.slice(2), 'hex'),
  })

  result = await evm.runCall({
    to: contractAddress,
    caller: accountAddress,
    data: Buffer.from(sigHash.slice(2), 'hex'),
  })

  greeting = AbiCoder.decode(['string'], result.execResult.returnValue)
  console.log(greeting)

  // statestore.store.print();
}

const generateContractAddress = (address, account) => {
  return new Address(generateAddress(address.buf, bigIntToBuffer(account.nonce)));
};

main();
