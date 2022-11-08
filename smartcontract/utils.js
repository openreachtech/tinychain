"use strict";

const { readFileSync } = require("fs");
const { ec } = require("elliptic");
const { defaultAbiCoder: AbiCoder, Interface } = require("@ethersproject/abi");
const Solc = require("solc");
const EC = new ec("secp256k1");

const now = () => Math.floor(new Date().getTime() / 1000);

const toHexString = (bytes) => {
  return Array.from(bytes, (byte) => {
    return ("0" + (byte & 0xff).toString(16)).slice(-2);
  }).join("");
};

const readWallet = (location) => {
  const buffer = readFileSync(location, "utf8");
  return EC.keyFromPrivate(buffer.toString(), "hex");
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

module.exports = { toHexString, now, readWallet, encodeDeployment, encodeFunction, compileContract };
