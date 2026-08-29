import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';

const POOL_DATA = {
  UserPoolId: import.meta.env.VITE_COGNITO_POOL_ID,
  ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
};

export class AuthManager {
  constructor() {
    try {
      this.userPool = new CognitoUserPool(POOL_DATA);
    } catch (e) {
      console.warn('[AuthManager] Failed to init Cognito pool:', e.message);
      this.userPool = null;
    }
    this.cognitoUser = null;
  }

  /** Check for existing valid session on page load */
  restoreSession() {
    return new Promise((resolve) => {
      if (!this.userPool) return resolve(null);
      const user = this.userPool.getCurrentUser();
      if (!user) return resolve(null);

      user.getSession((err, session) => {
        if (err || !session?.isValid()) return resolve(null);
        this.cognitoUser = user;
        resolve({
          idToken: session.getIdToken().getJwtToken(),
          sub: session.getIdToken().payload.sub,
          email: session.getIdToken().payload.email,
        });
      });
    });
  }

  /** Register a new account */
  register(email, password) {
    return new Promise((resolve, reject) => {
      const attrs = [
        new CognitoUserAttribute({ Name: 'email', Value: email }),
      ];
      this.userPool.signUp(email, password, attrs, null, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }

  /** Confirm email with verification code */
  confirmEmail(email, code) {
    return new Promise((resolve, reject) => {
      const user = new CognitoUser({ Username: email, Pool: this.userPool });
      user.confirmRegistration(code, true, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }

  /** Login and get tokens */
  login(email, password) {
    return new Promise((resolve, reject) => {
      const user = new CognitoUser({ Username: email, Pool: this.userPool });
      const authDetails = new AuthenticationDetails({ Username: email, Password: password });

      user.authenticateUser(authDetails, {
        onSuccess: (session) => {
          this.cognitoUser = user;
          resolve({
            idToken: session.getIdToken().getJwtToken(),
            sub: session.getIdToken().payload.sub,
            email: session.getIdToken().payload.email,
          });
        },
        onFailure: (err) => reject(err),
      });
    });
  }

  /** Get current valid token (auto-refreshes if expired) */
  getIdToken() {
    return new Promise((resolve, reject) => {
      if (!this.cognitoUser) return reject(new Error('Not logged in'));
      this.cognitoUser.getSession((err, session) => {
        if (err) return reject(err);
        if (!session?.isValid()) return reject(new Error('Session expired'));
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  /** Logout */
  logout() {
    if (this.cognitoUser) {
      this.cognitoUser.signOut();
      this.cognitoUser = null;
    }
  }

  /** Check if logged in */
  isLoggedIn() {
    return this.cognitoUser !== null;
  }

  /** Resend verification code */
  resendConfirmation(email) {
    return new Promise((resolve, reject) => {
      const user = new CognitoUser({ Username: email, Pool: this.userPool });
      user.resendConfirmationCode((err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }
}
