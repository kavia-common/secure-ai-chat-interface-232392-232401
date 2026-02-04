#!/bin/bash
cd /home/kavia/workspace/code-generation/secure-ai-chat-interface-232392-232401/frontend_app
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

