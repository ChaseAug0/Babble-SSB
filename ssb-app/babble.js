// improved-babble-plugin.js
'use strict';

const net = require('net');
const ssbKeys = require('ssb-keys');
const ssbValidate = require('ssb-validate');

module.exports = {
    name: 'babbleConsensus',
    version: '1.0.0',
    manifest: {
        publish: 'async'
    },
    init: (api, opts) => {
        // 从 opts 获取 Babble 的连接信息
        const babbleHost = opts.babbleHost || '127.0.0.1';
        const babblePort = opts.babblePort || 1338;
        const clientPort = opts.clientPort || 1339;

        // 维护一个缓存，跟踪已提交但未达成共识的消息
        const pendingMessages = new Map();

        // 维护最新的状态以正确构建消息
        let state = null;

        // 初始化验证状态
        api.getLatest(api.id, (err, latest) => {
            if (err) {
                console.error('Error getting latest message:', err);
                return;
            }

            state = ssbValidate.initial();
            if (latest) {
                state = ssbValidate.appendSync(state, latest.value);
            }
            console.log('Validation state initialized');
        });

        // 建立一个 TCP 连接，用于向 Babble 提交事务
        const babbleSocket = net.createConnection({ host: babbleHost, port: babblePort }, () => {
            console.log(`Connected to Babble at ${babbleHost}:${babblePort}`);
        });

        babbleSocket.on('error', err => {
            console.error('Babble socket error:', err);
        });

        let rpcId = 1;

        // 将 SSB 消息内容提交到 Babble 共识层
        function submitTxToBabble(content, cb) {
            // 为消息生成唯一ID，用于后续追踪
            const msgId = `pending-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;

            // 保存到待处理队列
            pendingMessages.set(msgId, {
                content: content,
                callback: cb,
                timestamp: Date.now()
            });

            const txData = Buffer.from(JSON.stringify({
                msgId: msgId,
                content: content,
                author: api.id
            }));

            const request = {
                id: rpcId++,
                method: 'Babble.SubmitTx',
                params: [txData.toString('base64')]
            };

            const requestStr = JSON.stringify(request) + "\n";
            babbleSocket.write(requestStr, 'utf8', () => {
                console.log('Submitted TX to Babble:', content);
                // 注意：我们不立即调用callback，而是等待共识
            });
        }

        // 覆盖 SSB 的 publish 方法
        function publish(content, cb) {
            console.log('BABBLE PLUGIN: Intercepted publish call for:', content.type);
            if (!content || !content.type) {
                return cb(new Error('Content must have a type'));
            }
            submitTxToBabble(content, cb);
        }

        // 处理共识后的消息
        function processConsensusMessage(txContent, txMetadata) {
            console.log('Processing consensus message with metadata:', txMetadata);
            console.log('Transaction content:', JSON.stringify(txContent));

            try {
                // 确保我们有正确的消息格式
                if (!txContent) {
                    console.error('Empty transaction content');
                    return;
                }

                // 尝试从不同格式中提取数据
                let msgId, content, author;

                if (typeof txContent === 'object') {
                    // 预期的格式
                    if (txContent.msgId && txContent.content && txContent.author) {
                        msgId = txContent.msgId;
                        content = txContent.content;
                        author = txContent.author;
                    }
                    // 备选格式1：可能直接是原始消息
                    else if (txContent.type) {
                        msgId = null; // 我们没有msgId
                        content = txContent;
                        author = api.id; // 假设是本地消息
                    }
                    // 备选格式2：可能嵌套在其他结构中
                    else if (txContent.message && typeof txContent.message === 'object') {
                        msgId = txContent.message.msgId || null;
                        content = txContent.message.content || txContent.message;
                        author = txContent.message.author || api.id;
                    }
                    else {
                        console.error('Unrecognized transaction format:', txContent);
                        return;
                    }
                } else {
                    console.error('Transaction content is not an object:', typeof txContent);
                    return;
                }

                console.log(`Processing message: id=${msgId}, author=${author}, content type=${content.type}`);

                // 检查是否是本地待处理消息
                const pending = msgId ? pendingMessages.get(msgId) : null;

                if (pending) {
                    console.log('Found matching pending message');

                    // 本地用户的消息，使用callback处理
                    /*try {
                        // 获取作者的最新消息
                        api.getLatest(author, (err, latest) => {
                            if (err) {
                                console.error('Error getting latest for consensus message:', err);
                                if (pending.callback) pending.callback(err);
                                return;
                            }

                            // 准备消息
                            const previous = latest ? latest.key : null;
                            const sequence = latest ? latest.value.sequence + 1 : 1;

                            console.log(`Creating message with previous=${previous}, sequence=${sequence}`);

                            // 构建完整消息（包括签名等）
                            api.db.create({
                                content: content,
                                previous: previous,
                                sequence: sequence,
                                author: author
                            }, (err, msg) => {
                                if (err) {
                                    console.error('Error creating consensus message:', err);
                                    if (pending.callback) pending.callback(err);
                                    return;
                                }

                                console.log('Message created, adding to database');

                                // 写入消息到本地数据库
                                api.db.add(msg, (err, value) => {
                                    if (err) {
                                        console.error('Error adding consensus message:', err);
                                        if (pending.callback) pending.callback(err);
                                    } else {
                                        console.log('Consensus message added:', value.key);

                                        // 更新验证状态
                                        state = ssbValidate.appendSync(state, value);

                                        // 调用原始回调
                                        if (pending.callback) pending.callback(null, value);
                                    }

                                    // 从待处理列表中移除
                                    pendingMessages.delete(msgId);
                                });
                            });
                        });
                    } catch (e) {
                        console.error('Error processing local consensus message:', e);
                        if (pending.callback) pending.callback(e);
                        pendingMessages.delete(msgId);
                    }*/
                    api.publish(content, (err, value) => {
                        if (err) {
                            console.error('Error publishing consensus message:', err);
                            if (pending.callback) pending.callback(err);
                        } else {
                            console.log('Consensus message published:', value.key);

                            // 调用原始回调
                            if (pending.callback) pending.callback(null, value);
                        }

                        // 从待处理列表中移除
                        pendingMessages.delete(msgId);
                    });
                } else if (author && author !== api.id) {
                    console.log('Processing message from another author:', author);

                    // 其他用户的消息，直接追加到本地日志
                    try {
                        // 获取作者的最新消息
                        api.getLatest(author, (err, latest) => {
                            if (err) {
                                console.error('Error getting latest for remote consensus message:', err);
                                return;
                            }

                            // 准备消息
                            const previous = latest ? latest.key : null;
                            const sequence = latest ? latest.value.sequence + 1 : 1;

                            console.log(`Creating remote message with previous=${previous}, sequence=${sequence}`);

                            // 构建完整消息
                            api.db.create({
                                content: content,
                                previous: previous,
                                sequence: sequence,
                                author: author
                            }, (err, msg) => {
                                if (err) {
                                    console.error('Error creating remote consensus message:', err);
                                    return;
                                }

                                // 写入消息到本地数据库
                                api.db.add(msg, (err, value) => {
                                    if (err) {
                                        console.error('Error adding remote consensus message:', err);
                                    } else {
                                        console.log('Remote consensus message added:', value.key);

                                        // 更新验证状态
                                        state = ssbValidate.appendSync(state, value);
                                    }
                                });
                            });
                        });
                    } catch (e) {
                        console.error('Error processing remote consensus message:', e);
                    }
                    // 在多节点环境中，这部分需要完善
                    // 需要考虑如何验证和安全地添加来自其他节点的消息
                } else {
                    // 找不到匹配的pending消息，但作者是本地用户
                    console.log('No pending message found for local author, may be a duplicate or out-of-order message');

                    // 可以选择处理或忽略这种情况
                }
            } catch (e) {
                console.error('Unexpected error in processConsensusMessage:', e);
            }
        }
        // 启动一个 TCP 服务器，用于接收 Babble 排序结果
        const commitServer = net.createServer();

        // 处理新连接
        commitServer.on('connection', (conn) => {
            console.log('New connection from Babble to commit server');

            conn.on('error', (err) => {
                console.error('Connection error on commit server:', err);
            });

            conn.on('close', () => {
                console.log('Babble connection to commit server closed');
            });

            let buffer = '';
            conn.on('data', (data) => {
                console.log('Received data from Babble:', data.toString().substring(0, 100) + '...');
                buffer += data.toString();

                // 按换行分割完整 JSON 消息
                let index;
                while ((index = buffer.indexOf("\n")) >= 0) {
                    const line = buffer.slice(0, index).trim();
                    buffer = buffer.slice(index + 1);

                    if (line) {
                        try {
                            console.log('Processing JSON line:', line);
                            const rpcMsg = JSON.parse(line);

                            // 处理 Babble 返回的共识提交消息
                            /*if (rpcMsg.method && (rpcMsg.method === 'State.CommitBlock' || rpcMsg.method === 'State.CommitTx')) {
                                console.log('Received commit message from Babble:', rpcMsg.method);
                                const block = rpcMsg.params[0];
                                console.log('Block data:', JSON.stringify(block));

                                if (block && Array.isArray(block.transactions)) {
                                    console.log(`Processing ${block.transactions.length} transactions from block`);

                                    // 按顺序处理交易
                                    block.transactions.forEach((base64Tx, idx) => {
                                        try {
                                            console.log(`Decoding transaction ${idx}`);
                                            const txData = JSON.parse(Buffer.from(base64Tx, 'base64').toString());
                                            console.log('Decoded transaction data:', JSON.stringify(txData));

                                            processConsensusMessage(txData, {
                                                block: block.round || block.index,
                                                timestamp: block.timestamp || Date.now()
                                            });
                                        } catch (e) {
                                            console.error('Error processing transaction from block:', e);
                                        }
                                    });
                                } else {
                                    console.warn('Block has no transactions or invalid format:', block);
                                }

                                // 回应 Babble - 使用正确的格式
                                const response = {
                                    id: rpcMsg.id,
                                    result: {
                                        stateHash: "",
                                        receipts: []
                                    }
                                };
                                console.log('Sending response to Babble:', JSON.stringify(response));
                                conn.write(JSON.stringify(response) + "\n");
                            }*/
                            // Replace the block processing section in your TCP server

                            // 处理 Babble 返回的共识提交消息
                            if (rpcMsg.method && (rpcMsg.method === 'State.CommitBlock' || rpcMsg.method === 'State.CommitTx')) {
                                console.log('Received commit message from Babble:', rpcMsg.method);
                                const block = rpcMsg.params[0];
                                console.log('Block data:', JSON.stringify(block));

                                // 检查正确的嵌套结构 - Babble将交易放在Body.Transactions中
                                if (block && block.Body && Array.isArray(block.Body.Transactions)) {
                                    const transactions = block.Body.Transactions;
                                    console.log(`Processing ${transactions.length} transactions from block ${block.Body.Index}`);

                                    // 按顺序处理交易
                                    transactions.forEach((base64Tx, idx) => {
                                        try {
                                            console.log(`Decoding transaction ${idx}:`, base64Tx.substring(0, 50) + '...');
                                            const txData = JSON.parse(Buffer.from(base64Tx, 'base64').toString());
                                            console.log('Decoded transaction data:', JSON.stringify(txData));

                                            processConsensusMessage(txData, {
                                                block: block.Body.Index,
                                                round: block.Body.RoundReceived,
                                                timestamp: block.Body.Timestamp || Date.now()
                                            });
                                        } catch (e) {
                                            console.error('Error processing transaction from block:', e);
                                        }
                                    });
                                } else {
                                    console.warn('Block has incorrect structure or no transactions:',
                                        block && block.Body ? 'Has Body but no Transactions array' : 'Missing Body property');
                                    console.log('Full block structure:', JSON.stringify(block, null, 2));
                                }

                                // 回应 Babble - 使用正确的格式
                                const response = {
                                    id: rpcMsg.id,
                                    result: {
                                        stateHash: "",
                                        receipts: []
                                    }
                                };
                                console.log('Sending response to Babble:', JSON.stringify(response));
                                conn.write(JSON.stringify(response) + "\n");
                            }
                            else {
                                // 处理其他类型的消息
                                console.log('Received non-commit message from Babble:', rpcMsg.method || 'unknown method');

                                // 默认回应
                                const response = { id: rpcMsg.id, result: true };
                                conn.write(JSON.stringify(response) + "\n");
                            }
                        } catch (e) {
                            console.error('Error parsing Babble message:', e, 'Raw message:', line);
                        }
                    }
                }
            });
        });

        // 错误处理
        commitServer.on('error', (err) => {
            console.error('Commit server error:', err);

            // 如果是地址已在使用，尝试其他端口
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${clientPort} is in use, trying ${clientPort + 1}`);
                setTimeout(() => {
                    commitServer.close();
                    commitServer.listen(clientPort + 1, () => {
                        console.log(`Babble commit server listening on alternate port ${clientPort + 1}`);
                        console.log('IMPORTANT: Update Babble --client-connect parameter to match this port');
                    });
                }, 1000);
            }
        });

        commitServer.listen(clientPort, () => {
            console.log(`Babble commit server listening on port ${clientPort}`);
        });


        // 定期清理过期的待处理消息
        setInterval(() => {
            const now = Date.now();
            for (const [msgId, data] of pendingMessages.entries()) {
                if (now - data.timestamp > 120000) { // 2分钟超时
                    console.warn('Message timed out waiting for consensus:', msgId);
                    if (data.callback) {
                        data.callback(new Error('Consensus timeout'));
                    }
                    pendingMessages.delete(msgId);
                }
            }
        }, 30000);

        // 将 API 暴露给 SSB
        return {
            publish
        };
    }
};