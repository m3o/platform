FROM alpine
RUN apk --no-cache add py-pip ca-certificates bash && pip install s3cmd
ADD "https://github.com/domwong/rump/releases/download/1.1.3/rump-1.1.3-linux-amd64.tar.gz" /rump
RUN chmod 755 /rump
COPY backup.sh /backup.sh
ENTRYPOINT ["/backup.sh"]
