import express from 'express';
import bcrypt from 'bcryptjs';

const app = express();
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // ex: "seu_usuario/seu_repositorio"

// Fila em memória RAM para acumular os cadastros
let filaCadastros = [];
let processando = false;

// ----------------------------------------------------
// ROTA: POST /cadastro
// ----------------------------------------------------
app.post('/cadastro', async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: "Usuário e senha são obrigatórios." });
    }

    const usuarioFormatado = usuario.toLowerCase().trim();
    const hashSenha = await bcrypt.hash(senha, 10);

    // Guarda a conta formatada na memória RAM
    filaCadastros.push({
        usuario: usuarioFormatado,
        senha: hashSenha,
        criadoEm: new Date().toISOString()
    });

    console.log(`[RAM] Novo cadastro retido na fila: ${usuarioFormatado} (Total na RAM: ${filaCadastros.length})`);

    // Se atingir 3 contas e não estiver processando outro lote, dispara o envio
    if (filaCadastros.length >= 3 && !processando) {
        processarLoteNovosArquivos();
    }

    return res.status(202).json({ 
        mensagem: "Cadastro recebido! Processando em lote.",
        posicaoFila: filaCadastros.length 
    });
});

// ----------------------------------------------------
// FUNÇÃO DE PROCESSAMENTO DO LOTE (RAM -> GITHUB)
// ----------------------------------------------------
async function processarLoteNovosArquivos() {
    if (filaCadastros.length === 0 || processando) return;
    processando = true;

    // Retira do buffer da RAM
    const lote = filaCadastros.splice(0, filaCadastros.length);
    console.log(`[LOTE] Processando ${lote.length} conta(s) para gravação no GitHub...`);

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
                console.log(`[OK] Arquivo ${fileName} criado no GitHub!`);
            } else {
                console.error(`[ERRO] Falha ao criar ${fileName}:`, await response.text());
            }
        } catch (err) {
            console.error(`[ERRO CRÍTICO] ao salvar ${conta.usuario}:`, err);
        }
    }

    processando = false;
}

// Timer de segurança: a cada 20s limpa o buffer da RAM mesmo se tiver menos de 3 contas
setInterval(() => {
    if (filaCadastros.length > 0) {
        console.log("[TIMER 20s] Descarregando cadastros acumulados...");
        processarLoteNovosArquivos();
    }
}, 20000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor exclusivo de Cadastro rodando na porta ${PORT}`));
