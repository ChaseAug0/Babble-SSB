# Babble-SSB

### ![Babble](https://github.com/mosaicnetworks/babble)
### Start Babble:

```shell
./babble run --listen=:1337 \
 --advertise=10.32.1.20:1337 \  # 替换为你的实际 IP 地址
 --proxy-listen=:1338 \
 --client-connect=127.0.0.1:1339 \
 --service-listen=:8080
```

### Start ssb-app

```shell
node index.js
```
