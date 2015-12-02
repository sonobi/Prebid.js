/**
 * appnexus.js - analytics adapter for appnexus
 */

var events = require('../events');
var utils = require('../utils');
var CONSTANTS = require('../constants.json');

var BID_REQUESTED = CONSTANTS.EVENTS.BID_REQUESTED;
var BID_TIMEOUT = CONSTANTS.EVENTS.BID_TIMEOUT;
var BID_RESPONSE = CONSTANTS.EVENTS.BID_RESPONSE;
var BID_WON = CONSTANTS.EVENTS.BID_WON;
var WIN_PRICE = 'win_price';
var LATENCY = 'latency';
var REASON = 'reason';
/*
var REASON_CODE = {
	NAVIGATION : -1,
	VALID : 0,
	TIMED_OUT : 1,
	NO_BID : 2,
	ERROR : 3,
	ABORTED : 4,
	NO_FILL_INVALID : 5,
	NO_FILL_CLIENT : 6
};*/

var REASON_CODE = {
	NAVIGATION : -1,
	VALID : 'VALID',
	TIMED_OUT : 'TIMED_OUT',
	NO_BID : 'NO_BID',
	ERROR : 3,
	ABORTED : 4,
	NO_FILL_INVALID : 5,
	NO_FILL_CLIENT : 6
};
//keep a list of timed out bidders
var timedOutBidders = [];

var defaultBaseURL = '%%BASE_URL%%';

var utUrl = 'http://hackathon.adnxs.com/ut/v2';
//store the base tracking URLs
var responseUrlMap = {};
//store the base tracking URLs
var requestUrlMap = {};
//flag to indicate analytics URLs ready
var utResponseAvailable = false;
//store a queue of requests
var urlsToFire = [];


/**
 * This will enable sending data to AppNexus analytics Only call once, or duplicate data will be sent!
 * @param  {object} options.memberId, options.tagId
 * @return {[type]}    [description]
 */
exports.enableAnalytics = function(options) {
	if(typeof options === 'undefined'){
		return;
	}
	if(typeof options.memberId === 'undefined' || typeof options.tagId === 'undefined'){
		utils.logError('memberId and tagId needed');
		return;
	}
	if(typeof options.enableDistribution !== 'undefined'){
		_enableDistribution = options.enableDistribution;
	}

	sendUtRequest(options.memberId, options.tagId);

	var bid = null;

	//first send all events fired before enableAnalytics called

	var existingEvents = events.getEvents();
	utils._each(existingEvents, function(eventObj) {
		var args = eventObj.args;
		if (!eventObj) {
			return;
		}
		if (eventObj.eventType === BID_REQUESTED) {
			//bid is 1st args
			bid = args[0];
			sendBidRequests(bid);
		} else if (eventObj.eventType === BID_RESPONSE) {
			//bid is 2nd args
			bid = args[1];
			sendBidResponses(bid);
			sendBidTimeouts(bid);

		} else if (eventObj.eventType === BID_TIMEOUT) {
			var bidderArray = args[0];
			timedOutBidders = bidderArray;

		} else if (eventObj.eventType === BID_WON) {
			bid = args[0];
			sendBidWon(bid);
		}
	});

	//Next register event listeners to send data immediately

	//bidRequests 
	events.on(BID_REQUESTED, function(bidRequestObj) {
		sendBidRequests(bidRequestObj);
	});

	//bidResponses 
	events.on(BID_RESPONSE, function(adunit, bid) {
		sendBidResponses(bid);
		sendBidTimeouts(bid);

	});

	//bidTimeouts 
	events.on(BID_TIMEOUT, function(bidderArray) {
		timedOutBidders = bidderArray;
	});

	//wins
	events.on(BID_WON, function(bid) {
		sendBidWon(bid);
	});
};


function sendBidRequests(bid){
	if(utResponseAvailable){
		var url = requestUrlMap[bid.bidderCode];
		if(url){
			var target = document.getElementsByTagName('head')[0];
			utils.loadPixelUrl(window.document, target, url, getUUID(), 'BID_RESPONSE');
		}
	}
	else{
		//indicate a send. 
		requestUrlMap[bid.bidderCode] = 'send';
	}

}

function getBaseUrl(bid){
	if(responseUrlMap[bid.bidderCode]){
		return responseUrlMap[bid.bidderCode];
	}
	else{
		return defaultBaseURL;
	}
}

function sendUrl(bidderCode, url){
	if(utResponseAvailable){
		//send now
		//
		utils._each(responseUrlMap[bidderCode], function(value){
			url = url.replace(defaultBaseURL, value);
		});
		var target = document.getElementsByTagName('head')[0];
		utils.loadPixelUrl(window.document, target, url, getUUID(), 'BID_RESPONSE');
	}
	else{
		//trigger it later when /ut is back
		if(typeof urlsToFire[bidderCode] === 'undefined' ){
			urlsToFire[bidderCode] = [];
		}
		urlsToFire[bidderCode].push( url );
	}
}

function sendBidResponses(bid) {
	if (bid && bid.bidderCode) {
		if(bid.getStatusCode() === 2){
			//no bid
			var url = getBaseUrl(bid);
			url = appendToQuery(url, LATENCY, bid.timeToRespond);
			url = appendToQuery(url, REASON, REASON_CODE.NO_BID);
			sendUrl(bid.bidderCode, url);
		}
	}
}

function sendBidTimeouts(bid) {
	if (bid && bid.bidderCode) {
		utils._each(timedOutBidders, function(bidderCode){
			if(bid.bidderCode === bidderCode){
				//send the timeout 
				var url = getBaseUrl(bid);
				url = appendToQuery(url, LATENCY, bid.timeToRespond);
				url = appendToQuery(url, REASON, REASON_CODE.TIMED_OUT);
				sendUrl(bid.bidderCode, url);
			}
		});
	}
}

function sendBidWon(bid) {

	var url = getBaseUrl(bid);
	url = appendToQuery(url, WIN_PRICE, bid.cpm);
	url = appendToQuery(url, LATENCY, bid.timeToRespond);
	url = appendToQuery(url, REASON, REASON_CODE.VALID);
	sendUrl(bid.bidderCode, url);
}

function sendUtRequest(memberId, tagId){
	var json = buildRequestJson(memberId, tagId);
	makePostRequest(utUrl, json);
}

/**
 * Make a HTTP(s) post
 * @param  {object} params [description]
 */
function makePostRequest(url, jsonObj) {

    var postData = JSON.stringify(jsonObj),
        async = true;

    var request = new XMLHttpRequest();
    request.onload = function() {
        if (request.status === 200) {
            try{                
                var response = JSON.parse(request.responseText);
                //TOOD handle response
                handleResponse(response);
            }
            catch(e){
                utils.logError('failed to parse ad response from impbus: ' + e.message);
            }
           
        } else {
            utils.logError(request.status + ' : ' + request.statusText);
        }
    };

    request.onerror = function(httpProgressEvent) {
        var statusCode = httpProgressEvent.target.status;
        var msg = 'Error contacting impbus endpoint: ' + url + ' http response code:' + statusCode;
    };

    request.open('POST', url, async);
    request.setRequestHeader('Content-Type', 'application/json');
    //enable cookies sent with POST
    request.withCredentials = true;

    try {
        request.send(postData);
    } catch (e) {
        utils.logError('Error making POST request: ' + e);
    }
}

function buildRequestJson (memberId, tagId) {
    var jsonObj = {},
    tags = [];

    //build tags
    var tag =  {
    	tagId : tagId
    };

    tag = createTag(tag);
    tags.push(tag);
    jsonObj.uuid = getUUID();
    jsonObj.member_id = memberId;

    jsonObj.tags = tags;

    return jsonObj;
}
function getUUID(){
	return Math.floor(Math.random()*90000) + 10000;
}

function createTag(tag) {
    var returnTag = {};
    //assign a uuid to tag obj
    tag.uuid = getUUID();
    //required param
    returnTag.uuid = tag.uuid;
    if(tag.tagId){
        returnTag.id = tag.tagId;
    }
    var sizes = [];
    sizes.push({
    	height:250,
    	width: 300
    });
    returnTag.sizes = sizes;
    return returnTag;

}

function handleResponse(response){
	if(response.error || response.nobid === true ){
		utils.logError('Error setup AppNexus analytics');
		return;
	}
	
	utils._each(response.tags, function(tag){
		utils._each(tag.ads, function(adsObj){
			if(adsObj.content_source === 'csm'){
				try{
					var key = adsObj.csm.handler[0].content;
					var value = adsObj.csm.response_url;
					
					//process any 'send' requests here
					var requestUrl = adsObj.csm.request_url;
					//requestUrl = requestUrl.replace('sin1.g.adnxs.com', 'hackathon.adnxs.com');
					if(requestUrlMap[key] === 'send'){
						fireUrl(requestUrl, 'BID_REQUEST');
					}
					// map base URLSs for response events
					
					//value = value.replace('sin1.g.adnxs.com', 'hackathon.adnxs.com');
					responseUrlMap[key] = value;
					//replace %%BASE_URL%% with actual domain & trigger
					if(urlsToFire[key]){
						utils._each(urlsToFire[key], function(url){
							url = url.replace(defaultBaseURL, value);
							fireUrl(url, 'BID_RESPONSE');
						});
					}

					//map URLs for any requests. 
					value = adsObj.csm.request_url;
					requestUrlMap[key] = value;

					
				}
				catch(e){
					utils.logError('Error saving URL for Appnexus analytics', 'analyticsAdapters/appnexus.js', e);
				}
				
			}
		});
	});

	utResponseAvailable = true;

	/*
	utils._each(urlsToFire, function(arr){
		utils._each(arr, function(url){
			var target = document.getElementsByTagName('head')[0];
			utils.loadPixelUrl(window.document, target, url, getUUID());
		});

	});
	*/
}


function getLoadTimeDistribution(time) {
	var distribution;
	if (time >= 0 && time < 200) {
		distribution = '0-200ms';
	} else if (time >= 200 && time < 300) {
		distribution = '200-300ms';
	} else if (time >= 300 && time < 400) {
		distribution = '300-400ms';
	} else if (time >= 400 && time < 500) {
		distribution = '400-500ms';
	} else if (time >= 500 && time < 600) {
		distribution = '500-600ms';
	} else if (time >= 600 && time < 800) {
		distribution = '600-800ms';
	} else if (time >= 800 && time < 1000) {
		distribution = '800-1000ms';
	} else if (time >= 1000 && time < 1200) {
		distribution = '1000-1200ms';
	} else if (time >= 1200 && time < 1500) {
		distribution = '1200-1500ms';
	} else if (time >= 1500 && time < 2000) {
		distribution = '1500-2000ms';
	} else if (time >= 2000) {
		distribution = '2000ms above';
	}

	return distribution;
}


function getCpmDistribution(cpm) {
	var distribution;
	if (cpm >= 0 && cpm < 0.5) {
		distribution = '$0-0.5';
	} else if (cpm >= 0.5 && cpm < 1) {
		distribution = '$0.5-1';
	} else if (cpm >= 1 && cpm < 1.5) {
		distribution = '$1-1.5';
	} else if (cpm >= 1.5 && cpm < 2) {
		distribution = '$1.5-2';
	} else if (cpm >= 2 && cpm < 2.5) {
		distribution = '$2-2.5';
	} else if (cpm >= 2.5 && cpm < 3) {
		distribution = '$2.5-3';
	} else if (cpm >= 3 && cpm < 4) {
		distribution = '$3-4';
	} else if (cpm >= 4 && cpm < 6) {
		distribution = '$4-6';
	} else if (cpm >= 6 && cpm < 8) {
		distribution = '$6-8';
	} else if (cpm >= 8) {
		distribution = '$8 above';
	}
	return distribution;
}

function appendToQuery(url, key, value){
	url = url + '&' + key + '=' + encodeURI(value);
	return url;
}

function fireUrl(url, evt){
	if(url.indexOf(defaultBaseURL) === -1){
		var target = document.getElementsByTagName('head')[0];
		utils.loadPixelUrl(window.document, target, url, getUUID(), evt);
	}
}

