import {ethers} from 'ethers';
import {config} from 'dotenv';
import WebSocket from 'ws';
import {Parser} from '@json2csv/plainjs';

const binaryToString = require('binary-string');
const fs = require('fs');
const csv = require("@fast-csv/parse")




const axios = require('axios').default;

config();

const privateKey = process.env.PRIVATE_KEY?.replace(/\\n/g, '\n') || '';

const provider = new ethers.JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc');

const userAddress = process.env.USER_ADDRESS || ''

async function getAvaxBalance() {
  const balance = await provider.getBalance(userAddress);
  return balance;
}

async function getUsdcBalance() {
  const usdcAddress = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
  const wallet = new ethers.Wallet(privateKey, provider);
  const usdcContract = new ethers.Contract(usdcAddress, ['function balanceOf(address) view returns (uint)'], wallet);
  const usdcBalance = await usdcContract.balanceOf(userAddress);
  return usdcBalance;
}

async function getFirmQuote(amount: string, side: string) {
  const takerAsset = side === 'buy' ? "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" : "0x0000000000000000000000000000000000000000"
  const makerAsset = side === 'buy' ? "0x0000000000000000000000000000000000000000" : "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" 
  const txType = side === 'buy' ? 1 : null
  const requestBody = {
      "chainid": 43114,
      "takerAsset": takerAsset,
      "makerAsset": makerAsset,
      "takerAmount": amount,
      "userAddress": userAddress,
      "txType": txType
    }
  let responseData: any 
  await axios.post('https://api.dexalot.com/api/rfq/firm', requestBody, {
    headers: {
      'x-apikey': process.env.DEXALOT_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  }).then((response: { data: any; }) => {
    responseData = response.data
  }).catch(function(error: any) {
    console.log(error)
    return error
  })
  return responseData
}

async function sendOrder(amount: string, side: string) {
  const wallet = new ethers.Wallet(privateKey, provider);
  if (side === 'buy') {
    const firmQuote = await getFirmQuote(amount, 'buy');
    console.log(firmQuote['tx']['data'], ' data response')
    const tx = await wallet.sendTransaction(
      firmQuote.tx 
  )
    await tx.wait()
  } else {
    const firmQuote = await getFirmQuote(amount, 'sell');
    console.log(firmQuote['tx']['data'], ' data response')
    const tx = await wallet.sendTransaction(
      firmQuote.tx
  )
    await tx.wait()
    console.log(tx)
  }
}

// A helper to search for values ​​in files =D
const findWord = async (text: string, filePath: any) => {
  const result = await fs.readFileSync(filePath);
  return Promise.resolve(RegExp("\\b" + text + "\\b").test(result));
};

async function write(filename: string, price: any, timestamp: any) {
  var appendThis = [{
    timestamp,
    price,
  }]
  var fields = ['timestamp', 'price'];

  var newLine = "\r\n";
  fs.stat(filename, function (err: null) {
    const parser = new Parser({ fields, header: false });
    
    if (err == null) {
  
      //write the actual data and end with newline
      var csv = parser.parse(appendThis) + newLine;
  
      fs.appendFile(filename, csv, function (err: any) {
        if (err) throw err;
      });
    } else {
      //write the headers and newline
  
      fs.writeFile(filename, newLine, function (err: any) {
        if (err) throw err;
      });
    }
  });
}

function averageLastN(numbers: any, n: number) {
  const slicedArray = numbers.slice(-n);
  const sum = slicedArray.reduce((acc: any, current: any) => acc + current, 0);
  return sum / slicedArray.length;
}

function readCsv(path: any) {
    return new Promise((resolve, reject) => {
      const data: any[] = [];
  
      csv
        .parseFile(path)
        .on("error", reject)
        .on("data", (row: any) => {
          data.push(row);
        })
        .on("end", () => {
          resolve(data);
        });
    });
  }
  


async function processMsgQue(msgData: any) {
    const interval = 200
    timeStamp = Date.now()
    const msgStr = await JSON.parse(binaryToString.fromBuffer(msgData))
  
    msgStr['timestamp'] = timeStamp
    var avaxPrice = msgStr.data['baseinUsd']

    // Adding a timestamp to the price data so it's easier to filter out duplicates. Dexalot sends the same data twice every 6 seconds.
    const timeStampData = msgStr['timestamp']
    if (avaxPrice !== undefined) {
      await write("priceData.csv", avaxPrice, timeStampData)    
    }


    const timeStampAndPriceDataArrays: any = await readCsv('priceData.csv');
    const priceDataArray = timeStampAndPriceDataArrays.map((data: any) => Number(data[1]))
    
    // Sometimes we get messages with no price data. We don't want to write these to the CSV. We also don't want to write duplicate data so I check if the last line in the CSV contains the current timestamp.
    if (priceDataArray.length > interval) {
      const avaxBalance = Number(await getAvaxBalance())
      const usdcBalance = Number(await getUsdcBalance())
      const last10Minutes = priceDataArray.slice(-100)
      const last20Minutes = priceDataArray.slice(-200)
      const sma10 = averageLastN(last10Minutes, 100)
      const sma20 = averageLastN(last20Minutes, 200)

      console.log('sma10: ', sma10)
      console.log('sma20: ', sma20)

      // Buy AVAX if the 10 minute moving average is greater than the 20 minute moving average and the AVAX balance is less than 1
      if (sma10 > sma20 && avaxBalance < (1*(10**18))) {
        console.log('buying...')
        sendOrder((usdcBalance - (1*10**6)).toString(), 'buy')
        
      // Sell AVAX if the 10 minute moving average is less than the 20 minute moving average and the USDC balance is less than 1
      } else if (sma10 < sma20 && usdcBalance <= (2*(10**6))) {
          await sendOrder((avaxBalance - (.01*(10**18))).toString(), 'sell') 
          console.log('sold')
    }
  }
  }
  

// export interface CandleDataRaw {
//   open: string
//   close: string
//   high: string
//   low: string
//   change: string
//   date: string
//   volume: string
// }

// export interface WsRawChartSnapshot {
//   data: CandleDataRaw[] | CandleDataRaw
//   type: string
//   pair: string
// }

// function chartSubscribe(charttype: string) {
//   const socket = new WebSocket('wss://api.dexalot.com')

//   const msg: any = {
//       data: "AVAX/USDC",
//       pair: "AVAX/USDC",
//       chart: charttype,
//       type: "chartsubscribe",
//     }

  
//     socket.send(JSON.stringify(msg))
// }

let lastActivity = Date.now()
setInterval(checkActivity, 10000)

function checkActivity() {
  const currentTime = Date.now()
  if (currentTime - lastActivity > 30000) {
    console.log('No activity for 30 seconds. Closing connection.')
    socketCloseListener()
  }
  lastActivity = currentTime
}

const socketOpenListener = () => {
  const msg = {
    data: 'AVAX',
    pair: 'AVAX/USDC',
    decimale: 3,
    type: 'subscribe'
  }
  ws.send(JSON.stringify(msg))
  console.log('Connected to the server')  
};

let messageCounter = 0

const messageListener = async (event: { data: any; }) => {
  messageCounter++
  if (messageCounter % 2 === 0) {
    const msgData = event.data
    const msgQue: WebSocket.Data[] = []
    msgQue.push(msgData)
    await processMsgQue(msgData)
  }
}

const socketCloseListener = () => {
  // Reconnect attempt
  const ws = new WebSocket('wss://api.dexalot.com');
  ws.close()
  ws.addEventListener('open', socketOpenListener);
  ws.addEventListener('message', messageListener);
  ws.addEventListener('close', socketCloseListener);
};

var ws = new WebSocket('wss://api.dexalot.com')
let timeStamp: number 

ws = new WebSocket('wss://api.dexalot.com')
ws.addEventListener('open', socketOpenListener);
ws.addEventListener('message', messageListener);
ws.addEventListener('close', socketCloseListener)
