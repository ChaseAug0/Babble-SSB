// index.js
var SecretStack = require('secret-stack')
const config = require('ssb-config')
const path = require('path')
const os = require('os')


const ssbDb = require('./wrapper-db')
const babble = require('./babble')

// 定义数据库路径
const dbPath = path.join(os.homedir(), '.ssb')

// For proper message construction
const ssbKeys = require('ssb-keys')
const ssbValidate = require('ssb-validate')

// This helps create properly formatted messages with correct sequence numbers
function createMessage(content, previous) {
    return ssbValidate.create(
        previous,
        appConfig.keys,
        null,
        content,
        Date.now()
    )
}

// 创建一个完整的配置对象
const appConfig = {
    path: dbPath,
    keys: config.keys,
    babbleHost: '127.0.0.1',
    babblePort: 1338,
    clientPort: 1339,
    global: {
        path: dbPath,
        caps: {
            shs: '1KHLiKZvAvjbY1ziZEHMXawbCEIM6qwjCDm3VYRan/s='
        },
        keys: config.keys
    }
}

console.log('Configuration prepared with path:', appConfig.path)

// 创建应用
var App = SecretStack(appConfig)
    .use(ssbDb)
    .use(babble)

var sbot = App(appConfig)
console.log('App created successfully')

// 使用 sbot.publish 发布内容
console.log("Attempting to publish via standard SSB API...")
sbot.publish({ type: 'test', text: 'Hello from standard API' }, (err, ack) => {
    if (err) console.error('Standard publish failed:', err)
    else console.log('Standard publish acknowledged:', ack)
})
// 测试2: 通过Babble插件直接发布

console.log("Attempting to publish directly via Babble plugin...")
sbot.babbleConsensus.publish({ type: 'test', text: 'Hello from direct plugin API' }, (err, ack) => {
    if (err) console.error('Direct plugin publish failed:', err)
    else console.log('Direct plugin publish acknowledged:', ack)
})

// 等待一段时间，确保所有异步操作有机会完成
setTimeout(() => {
    console.log("All publish operations completed or timed out")
}, 10000)