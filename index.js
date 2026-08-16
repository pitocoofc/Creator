import express from 'express';
import bcrypt from 'bcryptjs';
import cors from 'cors'; // 1. Importa o CORS

const app = express();

// 2. Libera o CORS para aceitar requisições de qualquer HTML/Navegador
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

let filaCadastros = [];
let processando = false;

// Rota de teste simples para acessar direto pelo navegador
app.get('/', (req, res) => {
    return res.status(200).send("API de Cadastro ativa e operante!");
});

// Rota POST do Cadastro
app.post('/cadastro', async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: "Usuário e senha são obrigatórios." });
    }

    const usuarioFormatado = usuario.toLowerCase().trim();
    const hashSenha = await bcrypt.hash(senha, 10);

    filaCadastros.push({
        usuario: usuarioFormatado,
        senha: hashSenha,
        criadoEm: new Date().toISOString()
    });

    console.log(`[RAM] Novo cadastro retido na fila: ${usuarioFormatado} (Total: ${filaCadastros.length})`);

    if (filaCadastros.length >= 3 && !processando) {
        processarLoteNovosArquivos();
    }

    return res.status(202).json({ 
        mensagem: "Cadastro recebido! Processando em lote.",
        posicaoFila: filaCadastros.length 
    });
});

async function processarLoteNovosArquivos() {
    if (filaCadastros.length === 0 || processando) return;
    processando = true;

    const lote = filaCadastros.splice(0, filaCadastros.length);

    for (const conta of lote) {
        try {
            const fileName = `contas/${conta.usuario}.json`;
            const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}`;

            const payload = {
                message: `feat: conta criada para ${conta.usuario}`,
                content: Buffer.from(JSON.stringify(conta, null, 2)).toString('base64')
            };

            await fetch(url, {
                method: 'PUT',
                headers: {
                    "Authorization": `Bearer ${GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github.v3+json",
                    "Content-Type": "application/json",
                    "User-Agent": "Render-Cadastro-Service"
                },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.error(`[ERRO CRÍTICO] ao salvar ${conta.usuario}:`, err);
        }
    }

    processando = false;
}

setInterval(() => {
    if (filaCadastros.length > 0) {
        processarLoteNovosArquivos();
    }
}, 20000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
