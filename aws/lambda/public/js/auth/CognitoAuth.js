/**
 * AWS Cognito認証管理クラス
 * ユーザー認証とJWTトークン管理を担当
 */
class CognitoAuth {
    constructor() {
        this.cognitoConfig = {
            region: 'ap-northeast-1', // 東京リージョン
            userPoolId: process.env.COGNITO_USER_POOL_ID || 'ap-northeast-1_XXXXXXXXX',
            userPoolWebClientId: process.env.COGNITO_CLIENT_ID || 'XXXXXXXXXXXXXXXXXXXXXXXXX',
            oauth: {
                domain: process.env.COGNITO_DOMAIN || 'your-domain.auth.ap-northeast-1.amazoncognito.com',
                scope: ['openid', 'email', 'profile'],
                redirectSignIn: window.location.origin,
                redirectSignOut: window.location.origin,
                responseType: 'code'
            }
        };

        this.currentUser = null;
        this.idToken = null;
        this.accessToken = null;

        this.init();
    }

    /**
     * 初期化処理
     */
    async init() {
        try {
            // AWS SDK設定
            AWS.config.region = this.cognitoConfig.region;
            
            // Cognito Identity Provider設定
            this.cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({
                region: this.cognitoConfig.region
            });

            // User Pool設定
            this.userPool = new AmazonCognitoIdentity.CognitoUserPool({
                UserPoolId: this.cognitoConfig.userPoolId,
                ClientId: this.cognitoConfig.userPoolWebClientId
            });

            // 認証状態を確認
            await this.checkAuthState();
            
            // イベントリスナー設定
            this.setupEventListeners();
            
        } catch (error) {
            console.error('Cognito initialization error:', error);
            this.showAuthContainer();
        }
    }

    /**
     * 認証状態を確認
     */
    async checkAuthState() {
        try {
            // URLからauthorization codeを確認（OAuth callbackの場合）
            const urlParams = new URLSearchParams(window.location.search);
            const authCode = urlParams.get('code');
            
            if (authCode) {
                await this.handleOAuthCallback(authCode);
                return;
            }

            // 既存のセッションを確認
            const currentUser = this.userPool.getCurrentUser();
            
            if (currentUser) {
                await this.refreshSession(currentUser);
            } else {
                this.showAuthContainer();
            }
            
        } catch (error) {
            console.error('Auth state check error:', error);
            this.showAuthContainer();
        }
    }

    /**
     * OAuth コールバック処理
     */
    async handleOAuthCallback(authCode) {
        try {
            // Authorization codeをtokenに交換
            const tokenResponse = await this.exchangeCodeForTokens(authCode);
            
            this.idToken = tokenResponse.id_token;
            this.accessToken = tokenResponse.access_token;
            
            // ユーザー情報を取得
            const userInfo = this.parseJwtToken(this.idToken);
            this.currentUser = userInfo;
            
            // URL cleanup
            window.history.replaceState({}, document.title, window.location.pathname);
            
            this.showMainContainer();
            
        } catch (error) {
            console.error('OAuth callback error:', error);
            this.showAuthContainer();
        }
    }

    /**
     * Authorization code を token に交換
     */
    async exchangeCodeForTokens(authCode) {
        const tokenUrl = `https://${this.cognitoConfig.oauth.domain}/oauth2/token`;
        
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: this.cognitoConfig.userPoolWebClientId,
            code: authCode,
            redirect_uri: window.location.origin
        });

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        if (!response.ok) {
            throw new Error('Token exchange failed');
        }

        return await response.json();
    }

    /**
     * セッションを更新
     */
    async refreshSession(cognitoUser) {
        return new Promise((resolve, reject) => {
            cognitoUser.getSession((err, session) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (session.isValid()) {
                    this.idToken = session.getIdToken().getJwtToken();
                    this.accessToken = session.getAccessToken().getJwtToken();
                    
                    const userInfo = this.parseJwtToken(this.idToken);
                    this.currentUser = userInfo;
                    
                    this.showMainContainer();
                    resolve(session);
                } else {
                    this.showAuthContainer();
                    reject(new Error('Session is not valid'));
                }
            });
        });
    }

    /**
     * JWT トークンをパース
     */
    parseJwtToken(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));

            return JSON.parse(jsonPayload);
        } catch (error) {
            console.error('JWT parse error:', error);
            return null;
        }
    }

    /**
     * ログイン処理
     */
    login() {
        const authUrl = `https://${this.cognitoConfig.oauth.domain}/oauth2/authorize` +
            `?client_id=${this.cognitoConfig.userPoolWebClientId}` +
            `&response_type=code` +
            `&scope=openid+email+profile` +
            `&redirect_uri=${encodeURIComponent(window.location.origin)}`;
        
        window.location.href = authUrl;
    }

    /**
     * ログアウト処理
     */
    logout() {
        const currentUser = this.userPool.getCurrentUser();
        if (currentUser) {
            currentUser.signOut();
        }

        this.currentUser = null;
        this.idToken = null;
        this.accessToken = null;

        const logoutUrl = `https://${this.cognitoConfig.oauth.domain}/logout` +
            `?client_id=${this.cognitoConfig.userPoolWebClientId}` +
            `&logout_uri=${encodeURIComponent(window.location.origin)}`;
        
        window.location.href = logoutUrl;
    }

    /**
     * 認証が必要なAPIリクエスト用のヘッダーを取得
     */
    getAuthHeaders() {
        if (!this.idToken) {
            throw new Error('No authentication token available');
        }

        return {
            'Authorization': `Bearer ${this.idToken}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * 認証コンテナを表示
     */
    showAuthContainer() {
        document.getElementById('auth-container').style.display = 'block';
        document.getElementById('main-container').style.display = 'none';
    }

    /**
     * メインコンテナを表示
     */
    showMainContainer() {
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('main-container').style.display = 'block';
        
        if (this.currentUser && this.currentUser.email) {
            document.getElementById('user-email').textContent = this.currentUser.email;
        }
    }

    /**
     * イベントリスナー設定
     */
    setupEventListeners() {
        document.getElementById('login-button')?.addEventListener('click', () => {
            this.login();
        });

        document.getElementById('logout-button')?.addEventListener('click', () => {
            this.logout();
        });
    }

    /**
     * ユーザーが認証済みかどうかを確認
     */
    isAuthenticated() {
        return this.currentUser !== null && this.idToken !== null;
    }

    /**
     * 現在のユーザー情報を取得
     */
    getCurrentUser() {
        return this.currentUser;
    }
}

// グローバルインスタンス
const cognitoAuth = new CognitoAuth();