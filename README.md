# hakoniwa-geo-viewer

Hakoniwa Droneの状態を、Maprayの3D地理空間、Leafletの2D地図、
Three.jsの局所3D表示へ統合するブラウザビューアです。

Maprayは都市・地形・全機位置・経路・軌跡・運航イベントを俯瞰する
**マクロ運航監視**、`hakoniwa-web3d-drone`は選択機の姿勢・ローター・
局所地形・衝突建物を見る**ミクロ解析**を担当します。物理計算と衝突判定の
正本はHakoniwa/MuJoCoであり、このリポジトリは表示と操作の統合を担当します。

## 主な機能

- Mapray JS 0.9.6によるDEM・B3D Building Datasetの3D表示
- Maprayを利用できない場合のLeaflet/OpenStreetMapフォールバック
- `hakoniwa-web3d-drone`公開APIを使ったThree.js局所表示
- ROSローカル座標から緯度・経度・絶対標高への変換
- 左パネル、Mapray、Leaflet、Three.js間の機体・インシデント選択同期
- 計画経路、ジオフェンス、実飛行軌跡、ルール違反、衝突地点の表示
- `DroneStatus.collided_counts`および`ImpulseCollision`のイベント化
- 10機fixtureと決定論的なデモ飛行
- Mapray軌跡の1秒サンプリング・最大120点によるメモリ上限制御
- API KeyやDataset障害時にも局所表示を継続する任意依存設計

## アーキテクチャ

```text
Hakoniwa Drone / MuJoCo
          |
          v
 shared-memory PDU
          |
          v
WebSocket Bridge (:8765)
          |
          v
   FlightStateStore
      |         |
      |         +---- hakoniwa-web3d-drone
      |                 Three.js局所解析
      |
      +---- Mapray 3D広域監視
      |         or
      +---- Leaflet 2Dフォールバック
```

`hakoniwa-web3d-drone`は`third_party/hakoniwa-web3d-drone`のGit submodule
として利用します。開発中はURLパラメータ`threejsRoot`で、同じHTTP origin上の
別チェックアウトへ切り替えることもできます。

## 責任範囲

このリポジトリが担当するもの:

- 地理ビューと局所3Dビューの統合
- 表示用の座標・高度変換
- 機体、軌跡、運航レイヤ、インシデントの表示
- 表示間の選択・カメラ同期
- Mapray初期化とLeafletフォールバック
- シナリオ設定と配備済みブラウザ資産の検証

このリポジトリが担当しないもの:

- ドローンの物理計算、制御、センサ計算
- shared-memory PDUからWebSocketへの変換
- CityGMLからMJCF、DEM、B3D入力を生成する処理
- Mapray Cloud Datasetの契約・権限管理
- シミュレーション全体のライフサイクル管理

CityGML、MJCF、DEM生成は
[`hakoniwa-simenv-data`](https://github.com/hako-community/hakoniwa-simenv-data)、
Three.js描画は
[`hakoniwa-web3d-drone`](https://github.com/hako-community/hakoniwa-web3d-drone)
が担当します。

実シミュレーションと接続する場合の基準構成は、Hakoniwa Business Packの
Recipe ID `drone-single-mujoco-threejs-gamepad`です。このRecipeがDrone service、
DroneVisualStatePublisher、shared-memory PDU、`hakoniwa-pdu-bridge-core`の
WebSocket Bridgeを起動し、本ビューアはそのWebSocket経路へ接続します。

## 必要環境

- Python 3.9以上
- WebGL 2を利用できるChromeまたはEdge
- Mapray表示時はMapray Cloud API Keyとネットワーク接続
- 実PDU接続時は互換性のあるWebSocket Bridge

Mapray CloudのAllowed Domainには、実際に開く`localhost:<port>`を登録します。
`127.0.0.1:<port>`ではなく`localhost:<port>`を使用してください。

## クローン

```bash
git clone --recursive https://github.com/hako-community/hakoniwa-geo-viewer.git
cd hakoniwa-geo-viewer
```

既存cloneでsubmoduleを取得する場合:

```bash
git submodule update --init --recursive
```

## 検証

```bash
python tools/hako.py doctor
python tools/hako.py test
python tools/hako.py smoke
```

| コマンド | 内容 |
|---|---|
| `doctor` | Python、必須ファイル、設定、再帰submoduleを確認 |
| `test` | 座標、シナリオ、R1〜R8契約、内包Web3D Viewerを検証 |
| `smoke` | 一時HTTPサーバーでHTML、JS、MJS、設定の取得を検証 |

ブラウザ描画とMapray Cloud接続は、API Keyと実ブラウザが必要なため別途確認します。

## 起動

### Maprayを含む統合workspaceでの推奨起動

ワークスペースルート`D:\work_hako\work_mapray`で実行します。

```powershell
python scripts\windows\serve_geo_viewer.py `
  --directory . `
  --port 18080 `
  --bind 0.0.0.0 `
  --env-file runtime\windows\config\.env
```

`.env`はGit管理外です。

```dotenv
MAPRAY_API_KEY=your-mapray-api-key
```

通常の渋谷シナリオ:

```text
http://localhost:18080/hakoniwa-geo-viewer/src/client/index.html?scenarioConfig=/hakoniwa-geo-viewer/config/viewer-config-shibuya.json&threejsRoot=/hakoniwa-web3d-drone
```

10機fixture:

```text
http://localhost:18080/hakoniwa-geo-viewer/src/client/index.html?scenarioConfig=/hakoniwa-geo-viewer/config/viewer-config-shibuya.json&threejsRoot=/hakoniwa-web3d-drone&r7Fixture=1
```

10機fixtureでは`connect`を押した後、`Demo Flight`を有効にします。通信を開始せず、
複数機、選択同期、軌跡、インシデント表示を確認できます。

### リポジトリ単体の静的確認

親ディレクトリから静的HTTPサーバーを起動できます。この方法では実行時API Key
エンドポイントがないため、MaprayはLeafletへフォールバックします。

```powershell
cd ..
python -m http.server 18080 --bind localhost
```

```text
http://localhost:18080/hakoniwa-geo-viewer/src/client/index.html
```

Python環境が`.mjs`をJavaScript MIME typeで配信しない場合は、`tools/hako.py smoke`
または統合workspaceの専用サーバーを使用してください。

## Mapray設定

Mapray JSはCDN版`0.9.6`を対象にしています。

`config/mapray.json`の主な項目:

- `sdkVersion`: 対象SDKバージョン
- `buildingDatasetIds`: B3D Building Dataset IDの配列
- `demDatasetId`: 地域DEM Dataset ID
- `terrainGridUrl`: MuJoCo/Three.jsと共通の標高格子
- `camera`: 初期カメラと注視点
- `collision`: 衝突法線長とマーカー上限

API Keyはソース、URL、設定JSONへコミットせず、専用HTTPサーバーの
`/__runtime/mapray-config`から実行時に渡します。Mapray初期化、DEM、Building
Datasetのいずれかが失敗しても、画面全体を停止せずLeafletへフォールバックします。

現在のB3D Datasetは600m局所評価用です。5km級の高精細B3D全域を配信済みとは
扱いません。広域デモは標準地図/DEMと局所B3Dを分けて評価します。

## シナリオと資産

設定の入口は`config/viewer-config-shibuya.json`です。

```text
viewer-config-shibuya.json
  -> scenarios/shibuya.json
       |- geo-origin.json
       |- mapray.json
       |- runtime-assets/shibuya/manifest.json
       |- runtime-assets/shibuya/terrain-grid.json
       |- runtime-assets/shibuya/buildings.xml
       `- web3d scene config
```

`runtime-assets/shibuya`には、`hakoniwa-simenv-data`で生成し、SHA-256とschemaを
検証した成果物だけを配備します。PLATEAUの原本や大容量CityGML ZIPはリポジトリへ
コミットしません。

高精細表示用の`13113_shibuya-ku_pref_2023_citygml_2_op.glb`は任意資産です。
このGLBは標準起動には不要であり、存在しなくても`doctor`、`test`、`smoke`と
Mapray/Leafletの基本表示を実行できます。配布する場合は、出典、加工内容、座標契約、
checksumをRelease Assetと一緒に記録します。

座標契約:

```text
MuJoCo/Three.js: modelHeightsM
Mapray:          modelHeightsM + zBaselineM
frame:           mujoco_x_north_y_minus_east_z_up
```

## 表示モード

| `layoutMode` | 地図 | Three.js | 用途 |
|---|---:|---:|---|
| `operations` | 72% | 28% | 広域運航監視 |
| `inspection` | 30% | 70% | 選択機の確認 |
| `incident` | 55% | 45% | 衝突・違反解析 |
| `offline` | 0% | 100% | Maprayなしの局所確認 |

境界バーをドラッグした場合もLeaflet、Mapray、Three.jsへresizeを通知します。

## URLパラメータ

| パラメータ | 用途 |
|---|---|
| `scenarioConfig` | Viewer scenario configのURL |
| `threejsRoot` | `hakoniwa-web3d-drone`の同一origin上のルート |
| `viewerConfigName` | Web3D Viewer設定名 |
| `layoutMode` | 初期レイアウト |
| `maprayMode` | `base`、`dem`、`full` |
| `droneProfile` | 機体モデルプロファイル |
| `environmentMode` | `physics`、`visual`、`none` |
| `r4Fixture=1` | 3機の選択同期fixture |
| `r7Fixture=1` | 10機の複数機fixture |

外部originの資産URLはシナリオローダーで拒否します。

## 衝突と運航イベント

- `DroneStatus.collided_counts`: 正式な接触回数
- `ImpulseCollision`: 接触位置・法線が提供される場合の詳細入力
- `flight_rules.mjs`: 経路逸脱、区域、高度ルールの純粋判定
- `collision_events.mjs`: 接触の分類・重複抑制
- `incident_scenario.mjs`: 決定論的なインシデントfixture

イベントは最大100件、Maprayの軌跡は1機あたり最大120点に制限します。

## 診断API

ブラウザコンソールから次を利用できます。

- `window.__hakoniwaFlightStateStore`
- `window.__hakoniwaR4Diagnostics()`
- `window.__hakoniwaEnvironmentDiagnostics`
- `window.__hakoniwaLayoutDiagnostics`

## セキュリティと公開時の注意

- `.env`、API Key、Organization Token、署名付きURLをコミットしない。
- API Keyをクエリパラメータで共有しない。
- `runtime-assets`へPLATEAU原本や未確認の大容量生成物を入れない。
- Dataset IDと公開範囲はMapray Cloud側の運用方針に従う。
- Mapray、OpenStreetMap、PLATEAUのattributionを保持する。

## 関連リポジトリ

- [hakoniwa-web3d-drone](https://github.com/hako-community/hakoniwa-web3d-drone)
- [hakoniwa-simenv-data](https://github.com/hako-community/hakoniwa-simenv-data)
- `hakoniwa-pdu-bridge-core`: shared-memory PDUとWebSocketの橋渡し
- `hakoniwa-drone-core`: ドローン物理と状態生成

## ライセンス

ルートのプロジェクトコードは
[PolyForm Noncommercial License 1.0.0](./LICENSE)で提供します。商用利用は
ライセンサーとの別途契約が必要です。

`third_party`、CDNライブラリ、地図・都市データにはそれぞれの公開元の条件が
適用されます。詳細は[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)を参照してください。
