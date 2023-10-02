import https from 'https';
import zlib from 'zlib';
import { promisify } from 'util';
const gunzipAsync = promisify(zlib.gunzip);

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
export const lambdaHandler = async (event, context) => { 
    const payload = Buffer.from(event.awslogs.data, 'base64');
    const gunzipped = (await gunzipAsync(payload)).toString('utf8');
    const eventDetails = JSON.parse(gunzipped);
    let messageArray = eventDetails.logEvents[0].message.split('\t');
    let errorJSON, errorType, errorMessage;
    let timestamp = messageArray[0];
    if (messageArray[4]){
        //real error
        /*
            messageArray:
            [
                '2020-09-04T00:38:00.810Z',
                'd440b814-371d-4077-a11d-47615727f4ec',
                'ERROR',
                'Invoke Error ',
                '{"errorType":"TypeError","errorMessage":"Cannot read property \'x\' of undefined","stack":["TypeError: Cannot read property \'x\' of undefined","    at Runtime.exports.main [as handler] (/var/task/services/webhooks/webpack:/tmp/example.js:1:1)","    at Runtime.handleOnce (/var/runtime/Runtime.js:66:25)"]}\n'
            ]
        */
        errorJSON = JSON.parse(messageArray[4]);
        errorType = errorJSON.errorType;
        errorMessage = errorJSON.errorMessage;
    } else {
        if(messageArray.length > 1){
            //console.error
            /*
            messageArray:
            [
                '2020-09-06T13:02:05.184Z',
                '466e6c7a-8cbf-4e53-bbf2-3409486f4b59',
                'ERROR',
                'THIS IS A CONSOLE ERROR TYPE\n'
            ]
            */
            errorType = 'console.error()';
            errorMessage = messageArray[3];
        } else{
            /*
            messageArray:
            [ '2020-09-06T13:57:55.672Z 64cad227-917f-4159-8791-f1c3818dc206 Task timed out after 1.00 seconds\n\n' ]
            */
            errorType = 'TIMEOUT';
            errorMessage = messageArray[0].substr(messageArray[0].indexOf('Task'));
            timestamp = messageArray[0].substr(0, messageArray[0].indexOf('Z')+1);
        }

    }

    let functionName = eventDetails.logGroup.split('/')[3];
    let logStream = eventDetails.logStream;
    await postToSlack(errorType, timestamp, errorMessage, functionName, logStream);
    return;
};
let postToSlack = (errorType, timestamp, errorMessage, functionName, logStream) => {
    return new Promise((resolve, reject) => {
        var options = {
            "method": "POST",
            "hostname": 'hooks.slack.com',
            "path": `/services/${process.env.SLACK_WEBHOOK_URL}`,
            "headers": {
                "Content-Type": "application/json"
            }
        };
        var req = https.request(options, (res) => {
            resolve('Success');
        });
        req.on('error', (e) => {
            reject(e.message);
        });
        // send the request
        req.write(JSON.stringify({
            "blocks": [
                {
                    "type": "section",
                    "fields": [
                        {
                            "type": "mrkdwn",
                            "text": `*Type:*\n${errorType}`
                        },
                        {
                            "type": "mrkdwn",
                            "text": `*Timestamp:*\n${timestamp}`
                        },
                        {
                            "type": "mrkdwn",
                            "text": `*Error:*\n${errorMessage}`
                        }
                    ]
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "plain_text",
                            "text": `Lambda: ${functionName}`,
                            "emoji": true
                        }
                    ]
                },
                {
                    "type": "context",
                    "elements": [
                        {
                            "type": "plain_text",
                            "text": `Log Stream: ${logStream}`,
                            "emoji": true
                        }
                    ]
                }
            ]
        }));
        req.end();
    });
};