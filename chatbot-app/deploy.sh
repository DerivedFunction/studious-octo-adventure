rm -rf dist *.zip
npm run build
cd dist && 7z a ../chrome.zip .