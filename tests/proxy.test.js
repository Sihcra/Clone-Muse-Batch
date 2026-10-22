'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { parseProxy, parseList, pickProxy, checkProxy } = require('../src/engine/proxy');

test('parseProxy: các dạng ip:port, ip:port:user:pass, user:pass@ip:port, socks5', () => {
  assert.deepEqual(parseProxy('1.2.3.4:8080'), { line: '1.2.3.4:8080', scheme: 'http', host: '1.2.3.4', port: 8080, username: '', password: '', server: 'http://1.2.3.4:8080' });
  const a = parseProxy('1.2.3.4:8080:u:p');
  assert.equal(a.username, 'u');
  assert.equal(a.password, 'p');
  const b = parseProxy('http://u:p@proxy.vn:3128');
  assert.equal(b.host, 'proxy.vn');
  assert.equal(b.username, 'u');
  assert.equal(parseProxy('socks5h://1.2.3.4:1080').server, 'socks5://1.2.3.4:1080');
  assert.match(parseProxy('socks5://u:p@1.2.3.4:1080').error, /socks5/);
  assert.equal(parseProxy('abc').error, 'Sai định dạng');
  assert.equal(parseProxy('1.2.3.4:99999').error, 'Sai cổng');
});

test('parseList bỏ dòng trống, ghi chú, trùng', () => {
  assert.equal(parseList('1.1.1.1:80\n\n# note\n1.1.1.1:80\n2.2.2.2:80').length, 2);
});

test('pickProxy: none / cố định / tự chọn giữ cố định / proxy chết đổi cái ít người dùng', () => {
  const list = '1.1.1.1:80\n2.2.2.2:80';
  const a = { id: 'a', name: 'A', proxy: '', proxyAuto: '' };
  const b = { id: 'b', name: 'B', proxy: '', proxyAuto: '1.1.1.1:80' };
  assert.equal(pickProxy({ ...a, proxy: 'none' }, [a], list).proxy, null);
  assert.equal(pickProxy({ ...a, proxy: '9.9.9.9:1' }, [a], list).proxy.host, '9.9.9.9');
  assert.throws(() => pickProxy({ ...a, proxy: 'bad' }, [a], list), /Proxy của A lỗi/);
  assert.equal(pickProxy(a, [a, b], list).auto, '2.2.2.2:80'); // 1.1.1.1 đã có B dùng
  assert.equal(pickProxy(b, [a, b], list).auto, '1.1.1.1:80'); // giữ cố định
  assert.equal(pickProxy(b, [a, b], list, new Set(['1.1.1.1:80'])).auto, '2.2.2.2:80'); // chết → đổi
  assert.throws(() => pickProxy(a, [a], list, new Set(['1.1.1.1:80', '2.2.2.2:80'])), /Tất cả proxy đều chết/);
  assert.deepEqual(pickProxy(a, [a], ''), { proxy: null, auto: '' });
});

test('checkProxy: proxy HTTP trả 200 cho CONNECT → sống; 407 → sai user/pass', async () => {
  const mk = code => new Promise(resolve => {
    const srv = net.createServer(s => s.once('data', () => s.end(`HTTP/1.1 ${code} X\r\n\r\n`))).listen(0, '127.0.0.1', () => resolve(srv));
  });
  const ok = await mk(200);
  const r1 = await checkProxy(parseProxy(`127.0.0.1:${ok.address().port}`));
  assert.equal(r1.ok, true);
  ok.close();
  const auth = await mk(407);
  const r2 = await checkProxy(parseProxy(`127.0.0.1:${auth.address().port}:u:p`));
  assert.deepEqual([r2.ok, r2.error], [false, 'Sai user/pass']);
  auth.close();
});
