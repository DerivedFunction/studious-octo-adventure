rm -rf dist *.zip
npm run build
7z a -xr@./.gitignore soa-source-code.zip .
cd dist && 7z a ../chrome.zip .