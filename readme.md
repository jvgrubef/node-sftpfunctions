# SFTPFunctions

## Descrição
A classe SFTPFunctions é uma implementação do protocolo SFTP (SSH File Transfer Protocol) em JavaScript para linux. Ela fornece uma série de métodos para manipulação de arquivos e diretórios usando o protocolo SFTP através de uma conexão segura SSH. Suporta:

```
REALPATH, OPENDIR, OPEN, READDIR, WRITE, CLOSE, READ, REMOVE, RMDIR, MKDIR, RENAME, STAT, LSTAT, FSTAT
```

## Método de uso
Para utilizar apenas passe o stream do SFTP para a classe no primeiro parâmetro para o construtor, também é possível definir um diretório fixo no segundo parâmetro enviado ao construtor, a classe já possui os códigos OPEN_MODE e STATUS_CODE, mas é possível passar para ela também no terceiro e quarto parâmetro

## Exemplo de uso
```javascript
const SFTPFunctions = require('./SFTPFunctions.js');
const fs            = require('fs');
const ssh2          = require('ssh2');

const directory = '/tmp';
const port      = 2222;
const ipv4      = '0.0.0.0';

(() => {
    new ssh2.Server({
        hostKeys: [fs.readFileSync('private-key.pem')]
    }, (client) => {
        console.log('Client connected!');
        client.on('authentication', (ctx) => {
            ctx.accept();
        })
        .on('ready', () => {
            console.log('User accepted');
            client.on('session', (accept, reject) => {
                const session = accept();
                session.on('sftp', (accept, reject) => {
                    const stream = accept();
                    new SFTPFunctions(stream, directory, null, null);
                });
            });
        })
        .on('close', () => {
            console.log('Client disconnected');
        });
    })
    .listen(port, ipv4, () => {
        console.log(`Listening on port ${ipv4}:${port}`);
    });
})();
```
## Dependências
Pacotes necessários para a classe: fs, path e userid;

Esta classe foi inspirada no pacote ssh2-sftp-server, disponível em:
https://github.com/131/ssh2-sftp-server/
