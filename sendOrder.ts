import {ethers} from 'ethers';
import {config} from 'dotenv';
import WebSocket from 'ws';
const binaryToString = require('binary-string');
const fs = require('fs');


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
    console.log(responseData)
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

function averageLastN(numbers: any, n: number) {
  const slicedArray = numbers.slice(-n);
  const sum = slicedArray.reduce((acc: any, current: any) => acc + current, 0);
  return sum / slicedArray.length;
}

async function processMsgQue(msgQue: any, ws: any, msgData: any) {
  while (msgQue.length > 0) {
    const msg = msgQue.shift();
    const interval = 200
    timeStamp = Date.now()
    const msgStr = JSON.parse(binaryToString.fromBuffer(msgData))
    msgStr['timestamp'] = timeStamp
    const avaxPrice = msgStr.data['baseinUsd']
    // Adding a timestamp to the price data so it's easier to filter out duplicates. Dexalot sends the same data twice every 6 seconds.
    const timeStampData = msgStr['timestamp']
    const priceDataObject = {avaxPrice, timeStampData}
    if (avaxPrice !== undefined) {
      priceDataArray.push(priceDataObject)
    }
    const uniquePriceDataArray = priceDataArray.filter((obj, index) => priceDataArray.findIndex((item) => item.timeStampData === obj.timeStampData) === index)
    if (priceDataArray.length > interval) {
      const avaxBalance = Number(await getAvaxBalance())
      const usdcBalance = Number(await getUsdcBalance())
      const last10Minutes = uniquePriceDataArray.map((priceData: any) => priceData.avaxPrice).slice(-100)
      const last20Minutes = uniquePriceDataArray.map((priceData: any) => priceData.avaxPrice).slice(-200)
      const sma10 = averageLastN(last10Minutes, 100)
      const sma20 = averageLastN(last20Minutes, 200)

      console.log('sma10: ', sma10)
      console.log('sma20: ', sma20)

      console.log(timeStamp, 'time stamp')
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
  }


let priceDataArray: any[] = [];
const ws = new WebSocket('wss://api.dexalot.com')
let timeStamp 

ws.onopen = () => {
  const msg = {
    data: 'AVAX',
    pair: 'AVAX/USDC',
    decimale: 3,
    type: 'subscribe'
  }
  ws.send(JSON.stringify(msg))
  console.log('Connected to the server')
}

ws.addEventListener('message', async function(event) {
  const msgData = event.data
  const msgQue: WebSocket.Data[] = []
  msgQue.push(msgData)
  setTimeout(async () => {
    await processMsgQue(msgQue, ws, msgData)
  }
)
})

ws.onclose = () => {
  console.log('Connection closed')
  ws.close()
}

ws.onerror = (error) => {
  console.log(error)
}
