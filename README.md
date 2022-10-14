# TinyChain

学習用のコード量の非常に少ない javascript 製のブロックチェーン

## TinyChain とは

エンジニアとしてブロックチェーンの理解を効率的に高めるのは`実際にブロックチェーンを作ってみる`だと思っています。
そこで、初学者向けにブロックチェーンのエッセンスを抽出して、簡略化したチェーンが TinyChain です。
どなたでもご理解できるように javascript で記述しました。
このプロジェクトが、Bitcoin や Ethereum 等の著名なブロックチェーンのコードを読み解く、足がかりになったら嬉しいです。

本プロジェクトは、ブロックチェーンの基礎を既に学習済みの方を対象としています。
まだ学習されていない方は、こちらの動画や資料を参考にしてみてください。

- [現役エンジニアが解説！ビットコインとは！#1](https://www.youtube.com/watch?v=mQvEpxdZtQY&t=8s&ab_channel=OpenReachTech)
- [Bitcoin の仕組み](https://docs.google.com/presentation/d/1G_xnpX7Tprpjh76WIyTt3M8HuDWOYcBD3MRlmz1TTwE/edit#slide=id.p)

また、こちらのブログを多分に参考にしています。のぞいてみてください。
[A blockchain in 200 lines of code](https://medium.com/@lhartikk/a-blockchain-in-200-lines-of-code-963cc1cc0e54#.dttbm9afr5)

## 構成

本プロジェクトは３部構成になっています。第一部では、Bitcoin のような POW 風のチェーンを作り、ここでブロックチェーンの基礎を網羅的に復習します。続く第二部では、第一部で作ったチェーンを POS で再実装します。通信部分もより実際の形に近づけます。最後の第三部では、簡単なスマートコントラクトが動作するチェーンを実装します。

- 第一部: [Bitcoin のような POW チェーンを作る](./pow)
