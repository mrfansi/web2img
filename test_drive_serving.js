import https from 'https';

// Test Drive static file serving
const testUrl = 'https://system-web2img.2wczxa.easypanel.host/storage/test.txt';

console.log('Testing Drive static file serving...');
console.log('URL:', testUrl);

const req = https.get(testUrl, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Content-Type:', res.headers['content-type']);
  
  if (res.statusCode === 200) {
    console.log('✅ Drive static file serving is working!');
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('File content:', data.trim());
    });
  } else {
    console.log('❌ Drive static file serving failed');
    console.log('Status:', res.statusCode);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const errorData = JSON.parse(data);
        console.log('Error details:', errorData);
      } catch {
        console.log('Response:', data);
      }
    });
  }
});

req.on('error', (err) => {
  console.log('❌ Error:', err.message);
});

req.setTimeout(10000, () => {
  console.log('❌ Request timed out');
  req.destroy();
});