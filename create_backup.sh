ssh oub 'rsync -av --exclude=node_modules snabba-schemat/ snabba-schemat-backup/'
now=$(date +%Y-%m-%d)
scp -r oub:~/snabba-schemat-backup ./$now
ssh oub 'rm -r snabba-schemat-backup/'