-- Owner-approved correction of the original internal distribution, not a new payment.
DO $$
BEGIN
 IF (SELECT initial_capital FROM sources WHERE id='chunky') IS DISTINCT FROM 7024.34::numeric
 OR (SELECT initial_capital FROM sources WHERE id='costs') IS DISTINCT FROM 1773.58::numeric
 OR (SELECT amount FROM composition WHERE id='chunky') IS DISTINCT FROM 7024.34::numeric
 THEN RAISE EXCEPTION 'La composición previa requiere revisión antes de reclasificar Chunky';
 END IF;
END $$;

INSERT INTO audit_log(entity,entity_id,action,before_data,after_data,reason)
VALUES ('composition','chunky','reclassify',
 '{"chunky":"7024.34","costs":"1773.58","total":"18150.00"}'::jsonb,
 '{"chunky":"6956.49","costs":"1841.43","total":"18150.00","transferred":"67.85"}'::jsonb,
 'Corrección solicitada por el propietario: usar el saldo menor de Chunky y trasladar la diferencia a Costos / otros. No es un pago ni un gasto nuevo.');

UPDATE sources SET initial_capital=6956.49 WHERE id='chunky';
UPDATE sources SET initial_capital=1841.43 WHERE id='costs';
UPDATE composition SET amount=6956.49,concept='Préstamo anterior de Chunky: saldo de la app' WHERE id='chunky';
INSERT INTO composition(id,source_id,concept,amount,kind)
VALUES ('chunky_difference','costs','Diferencia del préstamo anterior reclasificada desde Chunky',67.85,'financed');
