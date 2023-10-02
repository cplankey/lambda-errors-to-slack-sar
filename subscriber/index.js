// Load the SDK for JavaScript
import { CloudWatchLogsClient, DescribeSubscriptionFiltersCommand, DeleteSubscriptionFilterCommand, PutSubscriptionFilterCommand } from '@aws-sdk/client-cloudwatch-logs';
const cloudWatchLogsClient = new CloudWatchLogsClient({});
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
    console.log(JSON.stringify(event));
    const detail = event.detail;
    const resourceSplit = event.resources[0].split(':');
    const functionName = [resourceSplit[resourceSplit.length - 1]];

    // no action if this event is not about a lambda function
    if (!(detail["service"] === "lambda" && detail["resource-type"] === "function")) return;

    const tags = detail["tags"];

    console.log(tags);

    // if associated tags not contain the expected tag pair
    if (!tags.hasOwnProperty("monitoring") || JSON.parse(tags["monitoring"]) !== true) {
        //either lambda does not have monitoring tag, user removed monitoring tag, or monitoring tag is set to false
        console.log("This function does not have the monitoring tag or tag is not set to true");
        //check if log group has subscription matching subscriber
        let params = {
            logGroupName: `/aws/lambda/${functionName}`,
            /* required */
        };
        let describeSubscriptionFiltersResult;
        try {
            describeSubscriptionFiltersResult = await cloudWatchLogsClient.send(new DescribeSubscriptionFiltersCommand(params));
        } catch (err) {
            console.log('Unable to describe subscription filters');
            //dont throw so we can try removing the log subscription just in case it is there
        }
        if (describeSubscriptionFiltersResult.subscriptionFilters) {
            let removeParams;
            describeSubscriptionFiltersResult.subscriptionFilters.forEach(subscription => {
                if (subscription.destinationArn === process.env.ALERTER_LAMBDA) {
                    //alerter lambda is subscribed, need to remove
                    console.log("The function is subscribed to by the alerter lambda, need to remove");
                    removeParams = {
                        filterName: subscription.filterName,
                        logGroupName: `/aws/lambda/${functionName}`
                    };
                }
            });
            if (removeParams) {
                try{
                    await cloudWatchLogsClient.send(new DeleteSubscriptionFilterCommand(removeParams));
                }catch(err){
                    console.log(err);
                    throw err;
                }
            }
        } else {
            console.log("The function has no subscription filters");
        }
    } else {
        console.log(`Need to subscribe to ${event.resources[0]}`);
        let params = {
            destinationArn: process.env.ALERTER_LAMBDA,
            /* required */
            filterName: 'alerter-lambda',
            /* required */
            filterPattern: '?"Error: Runtime exited" ?"Task timed out after" ?"\tERROR\t" ?"\\"level\\":\\"error\\""',
            /* required */
            logGroupName: `/aws/lambda/${functionName}`,
            /* required */
            distribution: 'ByLogStream'
        };
        try {
            await cloudWatchLogsClient.send(new PutSubscriptionFilterCommand(params));
        } catch (err) {
            console.log(err);
            throw err;
        }

    }
    return {
        statusCode: 200,
        body: JSON.stringify({
                message: 'Success'
            },
            null,
            2
        ),
    };
};
