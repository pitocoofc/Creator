import express from 'express';
import bcrypt from 'bcryptjs';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

let filaCadastros = [];
let processando = false;

// Rota de teste
app.get('/', (req, res) => {
    return res.status(200).send("API de Cadastro ativa e operante!");
});

// ----------------------------------------------------
// ROTA POST: /cadastro
// ----------------------------------------------------
app.post('/cadastro', async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: "Usuário e senha são obrigatórios." });
    }

    const usuarioFormatado = usuario.toLowerCase().trim();

    // 1. Validação de Requisitos do Usuário (mínimo 5 caracteres)
    if (usuarioFormatado.length < 5) {
        return res.status(400).json({ erro: "O nome de usuário deve ter pelo menos 5 caracteres." });
    }

    // 2. Validação de Requisitos da Senha (mínimo 10 caracteres, 1 letra e 1 caractere especial)
    const temLetra = /[a-zA-Z]/.test(senha);
    const temEspecial = /[!@#$%^&*(),.?":{}|<>_\-\\]/.test(senha);

    if (senha.length < 10 || !temLetra || !temEspecial) {
        return res.status(400).json({ 
            erro: "A senha deve ter pelo menos 10 caracteres, contendo pelo menos uma letra e um caractere especial." 
        });
    }

    // 3. Verificar se o usuário já está na fila local (RAM)
    const jaEstaNaFila = filaCadastros.some(conta => conta.usuario === usuarioFormatado);
    if (jaEstaNaFila) {
        return res.status(400).json({ erro: "Este nome de usuário já está aguardando processamento." });
    }

    // 4. Verificar se o usuário já existe no GitHub (baixando/consultando o arquivo)
    try {
        const fileName = `contas/${usuarioFormatado}.json`;
        const urlGithub = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}`;

        const checagemGithub = await fetch(urlGithub, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Render-Cadastro-Service"
            }
        });

        if (checagemGithub.status === 200) {
            return res.status(400).json({ erro: "Este nome de usuário já está cadastrado." });
        }
    } catch (err) {
        console.error("[ERRO CHECAGEM GITHUB]", err);
        return res.status(500).json({ erro: "Erro ao verificar disponibilidade do usuário." });
    }

    // 5. Criptografar senha e salvar na RAM
    const hashSenha = await bcrypt.hash(senha, 10);

    filaCadastros.push({
        usuario: usuarioFormatado,
        senha: hashSenha,
        criadoEm: new Date().toISOString()
    });

    console.log(`[RAM] Novo cadastro retido na fila: ${usuarioFormatado} (Total na RAM: ${filaCadastros.length}/10)`);

    // Dispara se atingir o novo limite de 10 contas
    if (filaCadastros.length >= 10 && !processando) {
        processarLoteNovosArquivos();
    }

    return res.status(202).json({ 
        mensagem: "Cadastro aprovado! Processando em lote.",
        posicaoFila: filaCadastros.length 
    });
});

// ----------------------------------------------------
// FUNÇÃO DE PROCESSAMENTO DO LOTE (RAM -> GITHUB)
// ----------------------------------------------------
async function processarLoteNovosArquivos() {
    if (filaCadastros.length === 0 || processando) return;
    processando = true;

    const lote = filaCadastros.splice(0, filaCadastros.length);
    console.log(`[LOTE] Enviando lote de ${lote.length} conta(s) para o GitHub...`);

    for (const conta of lote) {
        try {
            const fileName = `contas/${conta.usuario}.json`;
            const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}`;

            const payload = {
                message: `feat: conta criada para ${conta.usuario}`,
                content: Buffer.from(JSON.stringify(conta, null, 2)).toString('base64')
            };

            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    "Authorization": `Bearer ${GITHUB_TOKEN}`,
                    "Accept": "application/vnd.github.v3+json",
                    "Content-Type": "application/json",
                    "User-Agent": "Render-Cadastro-Service"
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log(`[OK] Arquivo ${fileName} criado com sucesso no GitHub!`);
            } else {
                console.error(`[ERRO] Falha ao criar ${fileName}:`, await response.text());
            }
        } catch (err) {
            console.error(`[ERRO CRÍTICO] ao salvar ${conta.usuario}:`, err);
        }
    }

    processando = false;
}

// Timer ajustado para 1 minuto e 30 segundos (90.000 ms)
setInterval(() => {
    if (filaCadastros.length > 0) {
        console.log("[TIMER 1m30s] Descarregando cadastros acumulados...");
        processarLoteNovosArquivos();
    }
}, 90000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de Cadastro rodando na porta ${PORT}`));
