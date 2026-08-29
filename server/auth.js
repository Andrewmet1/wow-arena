import { CognitoJwtVerifier } from 'aws-jwt-verify';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: 'id',
  clientId: process.env.COGNITO_CLIENT_ID,
});

// Prefetch JWKS signing keys on startup
await verifier.hydrate();

export async function verifyToken(idToken) {
  const payload = await verifier.verify(idToken);
  return { sub: payload.sub, email: payload.email };
}
