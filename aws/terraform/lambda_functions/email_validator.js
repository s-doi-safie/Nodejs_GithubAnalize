/**
 * Cognito Pre-SignUp Lambda Trigger
 * メールドメイン制限を実装
 */
exports.handler = async (event) => {
    console.log('Pre-SignUp trigger event:', JSON.stringify(event, null, 2));
    
    const allowedDomain = process.env.ALLOWED_DOMAIN || '${allowed_domain}';
    
    try {
        const email = event.request.userAttributes.email;
        
        if (!email) {
            throw new Error('Email is required');
        }
        
        // メールドメインを抽出
        const emailDomain = email.split('@')[1];
        
        console.log(`Checking email domain: ${emailDomain} against allowed domain: ${allowedDomain}`);
        
        // ドメイン制限チェック
        if (allowedDomain && emailDomain !== allowedDomain) {
            console.log(`Email domain ${emailDomain} is not allowed. Expected: ${allowedDomain}`);
            
            // Cognitoにエラーを返す
            throw new Error(`Registration is restricted to ${allowedDomain} email addresses.`);
        }
        
        // 追加の検証ロジックがあればここに実装
        // 例：特定のユーザー名パターンの制限、既存ユーザーとの重複チェックなど
        
        console.log(`Email ${email} is approved for registration`);
        
        // 自動確認設定（必要に応じて）
        event.response.autoConfirmUser = true;
        event.response.autoVerifyEmail = true;
        
        return event;
        
    } catch (error) {
        console.error('Email validation error:', error);
        
        // Cognitoにエラーメッセージを返す
        throw new Error(error.message);
    }
};