# Glossário

## Estoque

- **Item do estoque**: qualquer coisa cadastrada no Estoque, com saldo, lotes e validade. No código, é o modelo `Product`. Todo item é um material ou um produto.
- **Material**: item de apoio ao atendimento, como agulha, algodão ou seringa. `Product.kind = "material"`.
- **Produto**: item aplicado ou usado como substância no procedimento, como ácido hialurônico, vaselina ou álcool. `Product.kind = "produto"`.

Material e produto seguem as mesmas regras (lote, validade, compra, saída, saldo mínimo, ficha técnica). A diferença é só de organização nas telas.

Nas telas que mostram os dois tipos juntos, use "item" para o genérico e "Materiais e produtos" nos títulos. Evite usar "material" para falar de qualquer item.
