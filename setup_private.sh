mkdir built
mkdir .well-known
mkdir cache
cd cache
mkdir users
cd ..
mkdir cert
mkdir htmlsMin
mkdir private
cd private

if [ ! -e activationCodes.json ]; then
cat > activationCodes.json << EOF
{
	"AAAA-AAAA-AAAA-AAAA": {
		"used": false,
		"usedOn": null
	}
}
EOF
fi

if [ ! -e activeUUIDs.json ]; then
cat > activeUUIDs.json << EOF
{}
EOF
fi

if [ ! -e permissions.json ]; then
cat > permissions.json << EOF
{}
EOF
fi

if [ ! -e foodConfig.json ]; then
cat > foodConfig.json << EOF
{
	"foodLink": "https://sodexo.mashie.com/public/app/S%C3%B6derk%C3%B6ket/e86ce755?country=se"
}
EOF
fi

if [ ! -e secret.json ]; then
cat > secret.json << EOF
{
    "key": "123ABC"
}
EOF
fi

if [ ! -e rsa_2048_priv.pem ]; then
openssl genrsa -out rsa_2048_priv.pem 2048;
openssl rsa -pubout -in rsa_2048_priv.pem -out rsa_2048_pub.pem;
fi

cd ..

echo "Generate certification files from https://www.sslforfree.com/ or use the commented commands below (in the 'setup_private.sh' file)"

# cd cert
# if [ ! -e key.pem ] || [ ! -e cert.pem ]; then
# openssl genrsa -out key.pem
# openssl req -new -key key.pem -out csr.pem
# openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out cert.pem
# rm csr.pem
# fi
# cd ..
