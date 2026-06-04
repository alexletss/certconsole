import logging

class HideChanges(logging.Filter):
    def filter(self, record):
        msg = record.getMessage()
        return "/changes?" not in msg

logging.getLogger("uvicorn.access").addFilter(HideChanges())