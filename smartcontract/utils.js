"use strict";

const { readFileSync } = require("fs");
const { ec } = require("elliptic");
const { defaultAbiCoder: AbiCoder, Interface } = require("@ethersproject/abi");
const Solc = require("solc");
const EC = new ec("secp256k1");

const emptySlot = "0000000000000000000000000000000000000000000000000000000000000000";
const ZeroAddress = "0x0000000000000000000000000000000000000000";

const now = () => Math.floor(new Date().getTime() / 1000);

const readWallet = (location) => {
  const buffer = readFileSync(location, "utf8");
  return buffer.toString();
};

const encodeDeployment = (bytecode, params) => {
  const deploymentData = bytecode;
  if (params) {
    const argumentsEncoded = AbiCoder.encode(params.types, params.values);
    return deploymentData + argumentsEncoded.slice(2);
  }
  return deploymentData;
};

const encodeFunction = (method, params) => {
  const parameters = params.types ?? [];
  const methodWithParameters = `function ${method}(${parameters.join(",")})`;
  const signatureHash = new Interface([methodWithParameters]).getSighash(method);
  const encodedArgs = AbiCoder.encode(parameters, params.values ?? []);
  return signatureHash + encodedArgs.slice(2);
};

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
  const output = JSON.parse(Solc.compile(JSON.stringify(input)));

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

  return output.contracts[file][file.slice(0, -4)].evm.bytecode.object;
};

const buildTxObj = (tx) => {
  let txObj = {};
  if (tx.from) txObj.from = tx.from;
  if (tx.to) txObj.to = tx.to;
  if (tx.amount) txObj.amount = tx.amount;
  if (tx.data) txObj.data = tx.data.toString("hex");
  if (tx.gasPrice) txObj.gasPrice = tx.gasPrice.toString();
  if (tx.gasLimit) txObj.gasLimit = tx.gasLimit.toString();
  if (tx.signature) txObj.signature = tx.signature;
  if (tx.hash) txObj.hash = tx.hash;
  return txObj;
};

module.exports = {
  emptySlot,
  ZeroAddress,
  EC,
  now,
  readWallet,
  encodeDeployment,
  encodeFunction,
  compileContract,
  buildTxObj,
};
