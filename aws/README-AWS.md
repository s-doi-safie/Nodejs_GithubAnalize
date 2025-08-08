# GitHub Analyzer AWS Migration

GitHub PR分析ツールのAWS移行版です。Lambda + DynamoDB + Cognitoを使用したサーバーレス構成で実装されています。

## アーキテクチャ

- **AWS Lambda**: Node.js 18で実装されたメインアプリケーション（静的ファイル配信 + API）
- **Amazon DynamoDB**: PRデータ、チーム情報の保存（単一テーブル設計）
- **Amazon Cognito**: メールドメイン制限付きユーザー認証
- **API Gateway**: HTTP API（CORS対応）
- **Systems Manager Parameter Store**: GitHub トークンの安全な保存
- **CloudWatch**: ログ・モニタリング
- **Terraform**: Infrastructure as Code
- **GitHub Actions**: CI/CD自動デプロイ

## プロジェクト構造

```
aws/
├── lambda/                    # Lambda関数
│   ├── index.js              # メインハンドラー
│   ├── package.json          # 依存関係
│   ├── routes/               # ルーティング
│   │   ├── api.js           # API エンドポイント
│   │   └── static.js        # 静的ファイル配信
│   ├── services/             # ビジネスロジック
│   │   ├── github-api.js    # GitHub API 統合
│   │   ├── dynamodb.js      # DynamoDB操作
│   │   └── data-processor.js # データ処理
│   ├── python-integration/   # Python機能移植
│   │   └── github-fetcher.js
│   └── public/              # 静的ファイル（既存 + Cognito認証）
├── terraform/                # インフラ定義
│   ├── main.tf              # メインリソース
│   ├── cognito.tf           # Cognito設定
│   ├── variables.tf         # 変数定義
│   └── outputs.tf           # 出力値
├── .github/workflows/        # CI/CDワークフロー
│   └── aws-deploy.yml
└── scripts/                  # デプロイ・管理スクリプト
    ├── build-lambda.sh
    ├── deploy.sh
    ├── local-dev.sh
    └── migration/
        ├── migrate-data.js
        └── validate-migration.js
```

## セットアップ手順

### 1. 前提条件

- Node.js 18以上
- Terraform 1.6以上
- AWS CLI v2
- 適切なAWS認証情報

### 2. 環境設定

```bash
# AWSプロファイルの設定
aws configure

# プロジェクトディレクトリに移動
cd aws

# Lambda依存関係のインストール
cd lambda
npm install
cd ..

# Terraform変数ファイルの作成
cd terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvarsを編集（GitHub トークン、組織名など）
```

### 3. デプロイ

#### 開発環境

```bash
# 自動デプロイスクリプトを使用
./scripts/deploy.sh deploy --env dev

# または手動で段階的に
./scripts/build-lambda.sh              # Lambda パッケージ作成
cd terraform
terraform init
terraform plan -var-file=terraform.tfvars
terraform apply
```

#### 本番環境

```bash
./scripts/deploy.sh deploy --env production --yes
```

## 設定項目

### 必須設定

- `github_token`: GitHub Personal Access Token
- `github_organization`: GitHub組織名
- `email_domain_restriction`: 許可するメールドメイン

### オプション設定

- `enable_cognito_auth`: Cognito認証の有効/無効
- `lambda_timeout`: Lambda関数のタイムアウト秒数
- `lambda_memory_size`: Lambda関数のメモリサイズ
- `enable_dynamodb_backup`: DynamoDBバックアップの有効/無効

## DynamoDB テーブル設計

### 単一テーブル: `github-analyzer-data`

| PK | SK | 用途 |
|---|---|---|
| `PR_DATA` | `CURRENT` | 最新のPR分析データ |
| `PR#{repo}#{number}` | `METADATA` | 個別PR詳細 |
| `TEAM#{team_name}` | `INFO` | チーム情報 |
| `USER#{username}` | `PROFILE` | ユーザープロファイル |
| `CACHE#{type}` | `{timestamp}` | APIキャッシュ |

## 認証システム

### Cognito設定

- **User Pool**: メールアドレスベース認証
- **Domain Restriction**: 指定ドメインのメールアドレスのみ許可
- **OAuth 2.0**: Authorization Code フロー
- **JWT**: API Gateway で自動検証

### フロントエンド統合

```javascript
// 認証状態の確認
if (cognitoAuth.isAuthenticated()) {
    // メインアプリケーションを表示
    showMainContainer();
} else {
    // ログイン画面を表示
    showAuthContainer();
}

// API呼び出し時の認証ヘッダー
const headers = cognitoAuth.getAuthHeaders();
```

## API エンドポイント

| エンドポイント | 認証 | 説明 |
|---|---|---|
| `GET /` | 必要 | メインアプリケーション |
| `GET /api/health` | 不要 | ヘルスチェック |
| `GET /api/review-data` | 必要 | PR分析データ取得 |
| `GET /api/teams` | 必要 | チーム情報取得 |
| `POST /run-python` | 必要 | PRデータ更新 |
| `POST /update-teams` | 必要 | チーム情報更新 |
| `GET /api/debug` | 必要 | デバッグ情報 |
| `GET /api/stats` | 必要 | 統計情報 |

## 開発・テスト

### ローカル開発

```bash
# 開発環境のセットアップ
./scripts/local-dev.sh setup

# ローカルサーバーの起動
./scripts/local-dev.sh start --port 3000

# Lambda関数のテスト
./scripts/local-dev.sh test-lambda

# コードの品質チェック
./scripts/local-dev.sh lint
```

### データ移行

既存のJSONファイルからDynamoDBへのデータ移行：

```bash
# 移行の実行
cd scripts/migration
node migrate-data.js --table-name your-table-name

# 移行結果の検証
node validate-migration.js --table-name your-table-name
```

## CI/CD パイプライン

### GitHub Actions ワークフロー

- **Pull Request**: Terraform plan実行、結果をPRにコメント
- **develop branch**: 開発環境へ自動デプロイ
- **main branch**: 本番環境へ自動デプロイ（手動承認）

### 必要なSecrets/Variables

#### Repository Secrets
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `GITHUB_TOKEN_FOR_API`
- `PROD_AWS_ACCESS_KEY_ID` (本番用)
- `PROD_AWS_SECRET_ACCESS_KEY` (本番用)

#### Repository Variables
- `PROJECT_NAME`
- `GITHUB_ORGANIZATION`
- `AWS_REGION`
- `EMAIL_DOMAIN_RESTRICTION`
- `COGNITO_CALLBACK_URLS`
- `COGNITO_LOGOUT_URLS`

## 運用・管理

### モニタリング

- CloudWatch Logs でアプリケーションログを確認
- API Gateway のアクセスログとメトリクス
- Lambda関数の実行時間とエラー率
- DynamoDB の読み書きキャパシティとスロットリング

### バックアップ

- DynamoDB Point-in-Time Recovery（本番環境で有効）
- Lambda関数のソースコードはGitで管理
- Terraformステートファイルのバックアップ

### コスト最適化

- Lambda のメモリサイズ・タイムアウト調整
- DynamoDB On-Demand 課金の使用
- CloudWatch Logs の保持期間設定
- 不要なリソースの定期的な削除

## トラブルシューティング

### よくある問題

#### 1. Lambda関数のタイムアウト
```bash
# タイムアウト時間を延長
terraform apply -var="lambda_timeout=120"
```

#### 2. DynamoDB アクセス権限エラー
IAMロールにDynamoDBアクセス権限が付与されているか確認

#### 3. Cognito認証エラー
コールバックURLとログアウトURLが正しく設定されているか確認

#### 4. GitHub API制限
レート制限に注意し、必要に応じてリクエスト間隔を調整

### ログの確認

```bash
# Lambda のログを確認
aws logs tail /aws/lambda/github-analyzer-dev-handler --follow

# API Gateway のログを確認
aws logs tail /aws/apigateway/github-analyzer-dev --follow

# デバッグ情報の取得
curl https://your-api-url/api/debug
```

### パフォーマンス最適化

- Lambda 関数のコールドスタート対策（Provisioned Concurrency）
- DynamoDB のキャッシュ戦略
- 静的ファイルの圧縮とキャッシュ
- API レスポンスの最適化

## セキュリティ

- Cognito による認証・認可
- メールドメイン制限
- API Gateway での CORS設定
- Lambda 関数の最小権限IAMロール
- GitHub トークンの暗号化保存（SSM Parameter Store）
- CloudWatch による監査ログ

## 今後の改善案

- [ ] カスタムドメインの設定
- [ ] WAF によるセキュリティ強化
- [ ] ElastiCache によるキャッシュ層の追加
- [ ] Step Functions による複雑なワークフロー管理
- [ ] X-Ray による分散トレーシング
- [ ] SES によるメール通知機能
- [ ] EventBridge による定期実行