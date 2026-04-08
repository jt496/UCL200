TEX = quiz_question.tex
PDFLATEX = pdflatex

.PHONY: all question answer clean

all: question answer

question:
	$(PDFLATEX) -jobname=question '\AtBeginDocument{\fullversionfalse}\input{$(TEX)}'
	$(PDFLATEX) -jobname=question '\AtBeginDocument{\fullversionfalse}\input{$(TEX)}'
	rm -f question.aux question.log question.out

answer:
	$(PDFLATEX) -jobname=answer '\AtBeginDocument{\fullversiontrue}\input{$(TEX)}'
	$(PDFLATEX) -jobname=answer '\AtBeginDocument{\fullversiontrue}\input{$(TEX)}'
	rm -f answer.aux answer.log answer.out

clean:
	rm -f question.aux question.log question.out question.pdf
	rm -f answer.aux answer.log answer.out answer.pdf
