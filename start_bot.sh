# keeps the trading bot running if error occurs

run_bot="npx tsx sendOrder.ts" 

until $run_bot; do
    echo "Bot crashed with exit code $?. Starting it back up..." >&2
    sleep 1
done