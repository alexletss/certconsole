import asyncio, sys, selectors
asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn
uvicorn.run("server:app", host="0.0.0.0", port=3000, loop="asyncio", log_level="info")