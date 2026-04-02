import jwt
import time
import sys

def generate_token(issuer, secret):
    payload = {
        'iss': issuer,
        'jti': str(time.time()), # Unique ID for the token
        'iat': int(time.time()), # Issued at
        'exp': int(time.time()) + 60 # Expires in 60 seconds
    }
    # PyJWT expects the secret to be a string or bytes, and returns a string
    token = jwt.encode(payload, secret, algorithm='HS256')
    return token

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python get_jwt.py <ISSUER> <SECRET>")
        sys.exit(1)
        
    issuer = sys.argv[1]
    secret = sys.argv[2]
    print(generate_token(issuer, secret))
