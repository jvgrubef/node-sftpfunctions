const fs     = require('fs');
const path   = require('path');
const userid = require('userid');

class SFTPFunctions {
    constructor(sftp, ROOT = null, OPEN_MODE = null, STATUS_CODE = null){
        this.sftp        = sftp;
        this.directories = {};

        this.OPEN_MODE = OPEN_MODE ?? { 
            READ: 1,
            WRITE: 2,
            APPEND: 4,
            CREAT: 8,
            TRUNC: 16,
            EXCL: 32
        };

        this.STATUS_CODE = STATUS_CODE ?? {
            OK: 0,
            EOF: 1,
            NO_SUCH_FILE: 2,
            PERMISSION_DENIED: 3,
            FAILURE: 4,
            BAD_MESSAGE: 5,
            NO_CONNECTION: 6,
            CONNECTION_LOST: 7,
            OP_UNSUPPORTED: 8
        };

        this.sftp.on('REALPATH', this.realpath.bind(this));
        this.sftp.on('OPENDIR',  this.opendir.bind(this));
        this.sftp.on('OPEN',     this.open.bind(this));
        this.sftp.on('READDIR',  this.readdir.bind(this));
        this.sftp.on('WRITE',    this.write.bind(this));
        this.sftp.on('CLOSE',    this.close.bind(this));
        this.sftp.on('READ',     this.read.bind(this));
        this.sftp.on('REMOVE',   this.remove.bind(this));
        this.sftp.on('RMDIR',    this.rmdir.bind(this));
        this.sftp.on('MKDIR',    this.mkdir.bind(this));
        this.sftp.on('RENAME',   this.rename.bind(this));
        this.sftp.on('STAT',     this.stat.bind(this, 'statSync'));
        this.sftp.on('LSTAT',    this.stat.bind(this, 'lstatSync'));
        this.sftp.on('FSTAT', (reqid, handle) => {
            this.stat('fstatSync', reqid, this.directories[handle]['reqpath'], handle);
        });

        this.root = ROOT ?? '/';
    }
    
    absolutePath(testpath) {
        if (this.root && !testpath.startsWith(this.root)) {
            testpath = path.join(this.root, testpath);

            const relativePath = path.relative(this.root, testpath);
            
            if (relativePath.startsWith('..')) {
                testpath = this.root;
            };
        };
    
        return testpath;
    }

    linuxAttr(filename, reqpath) {
        const listPermissions = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];

        try {
            const stats           = fs.statSync(reqpath);
            const user            = userid.username(stats.uid);
            const group           = userid.groupname(stats.gid);
            const type            = stats.isDirectory() ? 'd' : '-';

            const unixPermissions = (stats.mode & parseInt('777', 8)).toString(8);

            let mode = '';
            for (let i = 0; i < unixPermissions.length; i++) {
                mode += listPermissions[unixPermissions.charAt(i)];
            };

            const date = stats.mtime.toLocaleString('en', {
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }).replace(',', '');

            const longname = `${type}${mode} ${stats.nlink} ${user} ${group} ${stats.size} ${date} ${filename}`;

            const attrs = {
                mode: stats.mode,
                uid: stats.uid,
                gid: stats.uid,
                size: stats.size,
                atime: Math.floor(stats.atimeMs / 1000),
                mtime: Math.floor(stats.mtimeMs / 1000),
            };

            return { filename, longname, attrs };
        } catch (error) {
            console.error(error);
            return {
                filename,
                longname: `?????????? ? ? ? ? ? ? ? ${filename}`,
            };
        };
    };

    errorCode(code) {
        if(['ENOTEMPTY', 'ENOTDIR', 'ENOENT'].includes(code)) {
            return this.STATUS_CODE.NO_SUCH_FILE;
        };
        if(['EACCES', 'EEXIST', 'EISDIR'].includes(code)) {
            return this.STATUS_CODE.PERMISSION_DENIED;
        };
        return this.STATUS_CODE.FAILURE;
    };

    realpath(reqid, reqpath) {
        //Diretorio mascarado -> a raiz da navegacao e ajustada com this.root;
        reqpath = path.join('/', reqpath);
        this.sftp.name(reqid, [{filename: reqpath}]);
    };

    opendir(reqid, reqpath) {
        reqpath = this.absolutePath(reqpath);

        try {
            let reqstat = fs.statSync(reqpath);

            if(!reqstat.isDirectory()) {
                this.sftp.status(reqid, this.STATUS_CODE.FAILURE);
                return;
            };

        } catch(error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
            return;
        };

        this.open(reqid, reqpath, this.OPEN_MODE.READ);
    };

    open(reqid, reqpath, flags, attrs) {
        reqpath = this.absolutePath(reqpath);

        const mode = flags & this.OPEN_MODE.READ ? 'r' : 'w';

        if(mode != 'w' && !fs.existsSync(reqpath)){
            this.sftp.status(reqid, this.STATUS_CODE.NO_SUCH_FILE);
            return;
        };
        
        try {
            let handle = fs.openSync(reqpath, mode);
            let stat   = fs.statSync(reqpath);
            handle     = Buffer.from([handle]);

            this.directories[handle] = {
                reqpath,
                flags,
                stat,
                pos: 0,
                closed: false
            };

            this.sftp.handle(reqid, handle);
        } catch(error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    readdir(reqid, handle){
        if(!this.directories[handle]){
            this.sftp.status(reqid, this.STATUS_CODE.NO_SUCH_FILE);
            return;
        };

        if(this.directories[handle]['closed']) {
            this.sftp.status(reqid, this.STATUS_CODE.EOF);
            return;
        };

        try {
            let directories = fs.readdirSync(this.directories[handle]['reqpath']);
        
            directories.push('.', '..');
            directories = directories.map(item => 
                this.linuxAttr(item, path.join(this.directories[handle]['reqpath'], item))
            )
            
            this.directories[handle]['closed'] = true;
            this.sftp.name(reqid, directories);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    write(reqid, handle, offset, data){
        try {
            fs.writeSync(handle[0], data, 0, data.length, offset);
            this.sftp.status(reqid, this.STATUS_CODE.OK);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    close(reqid, handle){
        try {
            fs.closeSync(handle[0]);
            this.sftp.status(reqid, this.STATUS_CODE.OK);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    read(reqid, handle, offset, length){
        var state = this.directories[handle];

        if(offset >= state.stat.size){
            this.sftp.status(reqid, this.STATUS_CODE.EOF);
            return;
        };
    
        var size = state.stat.size - state.pos > length ? length : state.stat.size - state.pos;
        var buffer = new Buffer.alloc(size);
    
        fs.readSync(handle[0], buffer, 0, size, offset);
        state.pos += size;
    
        this.sftp.data(reqid, buffer);
    };

    remove(reqid, reqpath) {
        reqpath = this.absolutePath(reqpath);

        try {
            fs.unlinkSync(reqpath);
            this.sftp.status(reqid, this.STATUS_CODE.OK);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    rmdir(reqid, reqpath) {
        reqpath = this.absolutePath(reqpath);

        try {
            fs.rmdirSync(reqpath);
            this.sftp.status(reqid, this.STATUS_CODE.OK);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    mkdir(reqid, reqpath, attrs) {
        reqpath = this.absolutePath(reqpath);

        try {
            fs.mkdirSync(reqpath);
            this.sftp.status(reqid, this.STATUS_CODE.OK);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    rename(reqid, reqpath, topath){
        reqpath = this.absolutePath(reqpath);
        topath = this.absolutePath(topath);

        try {
            fs.renameSync(reqpath, topath);
            this.sftp.status(reqid, this.STATUS_CODE.OK);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };

    stat(statType, reqid, reqpath, handle) {
        reqpath = this.absolutePath(reqpath);
        
        try {
            const fstats = fs[statType](reqpath);
            const { mode, uid, gid, size, atime, mtime } = fstats;
    
            if (handle && this.directories[handle]) {
                this.directories[handle]['stats'] = fstats;
            };
    
            const stats = {
                mode,
                uid,
                gid,
                size,
                atime,
                mtime
            };
    
            this.sftp.attrs(reqid, stats);
        } catch (error) {
            console.log(error);
            this.sftp.status(reqid, this.errorCode(error.code));
        };
    };
};

module.exports = SFTPFunctions;
